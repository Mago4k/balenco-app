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

  return json({ ok: true, ...parsed })
})
