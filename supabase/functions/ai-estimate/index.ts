import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// AI estimate drafter. The contractor sends a job-site photo + a short note;
// Claude (vision) drafts itemized estimate line items. The Anthropic API key
// lives in this function's secrets (ANTHROPIC_API_KEY) and never touches the
// browser. Only a logged-in Supabase user can call it, so randoms can't spend
// the key.
//
//   POST { images: ["data:image/jpeg;base64,..."], note: "..." }
//     -> { ok, title, line_items: [{description,quantity,unit,unit_price}], notes }

const MODEL = 'claude-opus-4-8'   // swap to 'claude-haiku-4-5' to cut cost ~5x
const EFFORT = 'medium'           // 'low' | 'medium' | 'high' | 'xhigh' | 'max'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  // Only logged-in users may spend the API key.
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } },
  )
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return json({ error: 'Please sign in to use AI estimates.' }, 401)

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'AI estimates are not set up yet (no Anthropic API key configured).' }, 503)

  // Per-org monthly cap + usage logging — the Anthropic key is shared and billed
  // to the owner, so cap each tenant before spending it (denial-of-wallet guard).
  const sbAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const { data: profile } = await sbAdmin.from('profiles').select('org_id').eq('id', user.id).maybeSingle()
  const orgId = profile?.org_id
  if (!orgId) return json({ error: 'Your account is not set up yet.' }, 403)

  // Tiered AI access, enforced here rather than in the UI — this is what actually
  // protects the shared Anthropic key (a browser gate is trivially bypassed):
  //   paid (active/past_due) -> full monthly allowance
  //   free trial             -> a small taste, so the demo still sells the plan
  //   lapsed / canceled      -> nothing
  // A MISSING subscriptions row lands on the trial tier, not full access: a data
  // hiccup still leaves a paying user a few drafts, but a row that never gets
  // created can't hand out an unlimited free allowance.
  const PAID_CAP = Number(Deno.env.get('AI_MONTHLY_CAP') || 50)
  const TRIAL_CAP = Number(Deno.env.get('AI_TRIAL_CAP') || 3)

  const { data: sub } = await sbAdmin.from('subscriptions').select('status,trial_end').eq('org_id', orgId).maybeSingle()
  const paid = !!sub && (sub.status === 'active' || sub.status === 'past_due')
  const onTrial = !!sub && sub.status === 'trialing' && !!sub.trial_end && new Date(sub.trial_end) > new Date()

  if (!paid && !onTrial && sub) {
    return json({
      error: 'Your Balenco plan is inactive. Choose a plan to keep drafting estimates with AI.',
      upgrade: true,
    }, 402)
  }

  const tier = paid ? 'paid' : 'trial'
  const CAP = paid ? PAID_CAP : TRIAL_CAP

  const _now = new Date()
  const monthStart = new Date(Date.UTC(_now.getUTCFullYear(), _now.getUTCMonth(), 1)).toISOString()
  const { count: usedThisMonth } = await sbAdmin.from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId).gte('created_at', monthStart)
  if ((usedThisMonth ?? 0) >= CAP) {
    return json({
      error: tier === 'trial'
        ? `Your free trial includes ${CAP} AI drafts and you've used them. Choose a plan to unlock ${PAID_CAP} drafts a month.`
        : `Monthly AI limit reached (${CAP} drafts). It resets at the start of next month.`,
      upgrade: tier === 'trial',
    }, 429)
  }

  const body = await req.json().catch(() => ({}))
  const note = String(body.note || '').slice(0, 4000)
  const images: string[] = Array.isArray(body.images)
    ? body.images.slice(0, 4)
    : (body.image ? [body.image] : [])
  if (!images.length && !note.trim())
    return json({ error: 'Add a photo or a description of the job.' }, 400)

  const content: unknown[] = []
  for (const img of images) {
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/s.exec(img)
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: m ? m[1] : 'image/jpeg', data: m ? m[2] : img },
    })
  }
  content.push({
    type: 'text',
    text: note.trim()
      ? `The contractor's notes about this job:\n${note.trim()}`
      : 'No written notes — base the estimate on the photo(s).',
  })

  const system = `You are an estimating assistant for a Québec construction & renovation contractor using the Balenco app.
From the job-site photo(s) and any notes, draft a realistic, itemized estimate the contractor can review and send.

Rules:
- Produce the kind of line items a tradesperson puts on a real quote: a short description, a quantity, a unit ("sq ft", "linear ft", "hour", "each", "lot"), and a unit price in Canadian dollars.
- Estimate quantities from what's visible or implied; approximate measurements are fine — state your assumptions in "notes".
- Use realistic current Québec labour + material pricing. Never use 0 — give a sensible mid-range number when unsure.
- Prefer a handful of meaningful line items over a long list of trivial ones.
- Do NOT add taxes (TPS/TVQ); the app adds those. All prices are pre-tax.
- Put measurement assumptions, exclusions, and anything to confirm on site into "notes".`

  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      title: { type: 'string', description: 'Short job title, e.g. "Bathroom tile replacement"' },
      line_items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            description: { type: 'string' },
            quantity: { type: 'number' },
            unit: { type: 'string' },
            unit_price: { type: 'number' },
          },
          required: ['description', 'quantity', 'unit', 'unit_price'],
        },
      },
      notes: { type: 'string' },
    },
    required: ['title', 'line_items', 'notes'],
  }

  let resp: Response
  try {
    resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system,
        messages: [{ role: 'user', content }],
        output_config: { effort: EFFORT, format: { type: 'json_schema', schema } },
      }),
    })
  } catch (e) {
    console.error('fetch failed', e)
    return json({ error: 'Could not reach the AI service. Try again.' }, 502)
  }

  if (!resp.ok) {
    const detail = await resp.text()
    console.error('Anthropic error', resp.status, detail)
    const msg = resp.status === 401 ? 'The AI key is invalid — check the Anthropic key.'
      : resp.status === 429 ? 'The AI is busy right now. Try again in a moment.'
      : resp.status === 400 ? 'The AI could not read that image. Try a clearer or smaller photo.'
      : 'The AI estimate failed. Try again.'
    return json({ error: msg }, 502)
  }

  const data = await resp.json()
  const textBlock = (data.content || []).find((b: { type: string }) => b.type === 'text')
  if (!textBlock) return json({ error: 'The AI returned no estimate. Try again.' }, 502)
  let parsed
  try { parsed = JSON.parse(textBlock.text) } catch {
    return json({ error: 'The AI returned an unreadable estimate. Try again.' }, 502)
  }

  // Log usage for the monthly cap + per-tenant cost attribution.
  try {
    await sbAdmin.from('ai_usage').insert({
      org_id: orgId, user_id: user.id, model: MODEL,
      input_tokens: data.usage?.input_tokens ?? null,
      output_tokens: data.usage?.output_tokens ?? null,
    })
  } catch (e) { console.error('ai_usage log failed', e) }

  // Hand back the tier + what's left so the UI badge stays honest without re-querying.
  return json({ ok: true, tier, remaining: Math.max(CAP - ((usedThisMonth ?? 0) + 1), 0), ...parsed })
})
