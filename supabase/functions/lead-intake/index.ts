import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Public, unauthenticated webhook (verify_jwt = false). Facebook/Instagram Lead
// Ads → Zapier/Make → POST here with the org's secret key. We map the (varying)
// field names, resolve key → org, and drop the lead into public.leads. Zapier
// owns all the Meta OAuth, so there's no Meta app-review to clear.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-balenco-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const htmlEscape = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c])
// Strip control chars + cap length (defeats header/subject injection, bounds storage).
const clean = (s: unknown, max: number): string => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
const jsonResp = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return jsonResp({ error: 'Use POST.' }, 405)

  // ---- Parse body: JSON first, then form-urlencoded (Zapier can send either) ----
  let body: Record<string, any> = {}
  const ctype = (req.headers.get('content-type') || '').toLowerCase()
  try {
    if (ctype.includes('application/json')) {
      body = await req.json()
    } else {
      const raw = await req.text()
      if (raw && raw.trim().startsWith('{')) body = JSON.parse(raw)
      else if (raw) for (const [k, v] of new URLSearchParams(raw)) body[k] = v
    }
  } catch (_) { body = {} }
  if (!body || typeof body !== 'object' || Array.isArray(body)) body = {}

  // Flatten Meta's native field_data:[{name,values:[...]}] shape if it comes raw.
  if (Array.isArray((body as any).field_data)) {
    for (const f of (body as any).field_data) {
      if (f && f.name) body[f.name] = Array.isArray(f.values) ? f.values[0] : f.values
    }
  }

  // ---- Authorize by the org's secret key (query > header > body) ----
  const url = new URL(req.url)
  const key = String(url.searchParams.get('key') || req.headers.get('x-balenco-key') || body.key || body.token || '').trim()
  if (!key) return jsonResp({ error: 'Missing webhook key.' }, 401)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: org, error: orgErr } = await sb.from('orgs').select('id').eq('lead_intake_key', key).maybeSingle()
  if (orgErr) return jsonResp({ error: 'Lookup failed.' }, 500)
  if (!org) return jsonResp({ error: 'Invalid webhook key.' }, 401)

  // ---- Liberal field mapping (Zapier/Make field names vary per contractor) ----
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = body[k]
      if (v != null && String(v).trim() !== '') return String(v)
    }
    return ''
  }
  let rawName = pick('name', 'full_name', 'fullName', 'lead_name', 'full name')
  if (!rawName) rawName = (pick('first_name', 'firstName', 'first name') + ' ' + pick('last_name', 'lastName', 'last name')).trim()
  const email = pick('email', 'email_address', 'emailAddress', 'work_email', 'e-mail')
  const phone = pick('phone', 'phone_number', 'phoneNumber', 'mobile', 'tel', 'telephone')
  let source = pick('source', 'platform', 'channel') || 'Facebook'
  if (/insta/i.test(source)) source = 'Instagram'
  else if (/face|fb|meta/i.test(source)) source = 'Facebook'
  const project = pick('project', 'project_needed', 'service', 'service_needed', 'job_type', 'need', 'interested_in', 'i_am_interested_in')
  const message = pick('message', 'notes', 'comments', 'description', 'details', 'question', 'best_time_to_call', 'additional_info')

  const sName = clean(rawName, 120)
  const sEmail = clean(email, 160)
  const sPhone = clean(phone, 40)
  const sSource = clean(source, 40)

  // Require at least one contact signal — never store a blank junk lead.
  if (!sName && !sEmail && !sPhone) {
    return jsonResp({ error: 'No lead data — need at least a name, email, or phone.' }, 400)
  }

  // notes = message + any unmapped scalar fields, so no submitted answer is lost.
  const consumed = new Set([
    'key', 'token', 'name', 'full_name', 'fullName', 'lead_name', 'full name',
    'first_name', 'firstName', 'first name', 'last_name', 'lastName', 'last name',
    'email', 'email_address', 'emailAddress', 'work_email', 'e-mail',
    'phone', 'phone_number', 'phoneNumber', 'mobile', 'tel', 'telephone',
    'source', 'platform', 'channel',
    'project', 'project_needed', 'service', 'service_needed', 'job_type', 'need', 'interested_in', 'i_am_interested_in',
    'message', 'notes', 'comments', 'description', 'details', 'question', 'best_time_to_call', 'additional_info',
    'field_data',
  ])
  const extras: string[] = []
  for (const k of Object.keys(body)) {
    if (consumed.has(k)) continue
    const v = body[k]
    if (v == null || typeof v === 'object') continue
    const sv = String(v).trim()
    if (sv) extras.push(`${k}: ${sv.slice(0, 200)}`)
  }
  let notes = String(message ?? '').replace(/\r\n?/g, '\n').trim()
  if (extras.length) notes = (notes ? notes + '\n\n' : '') + extras.join('\n')
  notes = notes.slice(0, 2000)

  const sProject = clean(project, 160) || (notes ? notes.split('\n')[0].slice(0, 80) : 'New ' + sSource + ' lead')
  const displayName = sName || ('Lead from ' + sSource)

  // ---- Insert into the org's existing lead inbox ----
  const id = crypto.randomUUID()
  const { error: insErr } = await sb.from('leads').insert({
    id,
    org_id: org.id,
    name: displayName,
    phone: sPhone,
    email: sEmail,
    source: sSource,
    project: sProject,
    status: 'New',
    notes,
    created_by: sSource + ' Lead Ad',
    created_at: new Date().toISOString(),
  })
  if (insErr) return jsonResp({ error: insErr.message }, 500)

  // ---- Best-effort: email the owner so they can call the lead fast ----
  // (speed-to-lead wins the contract). Never blocks the 200 — the lead is saved.
  try {
    const { data: settings } = await sb.from('settings').select('email,company').eq('org_id', org.id).maybeSingle()
    const to = settings?.email
    const resendKey = Deno.env.get('RESEND_API_KEY')
    if (to && resendKey) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Balenco <notifications@mail.balenco.app>',
          to,
          subject: `🎯 Nouveau prospect ${sSource} — ${displayName.slice(0, 80)}`,
          html: `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fff">
  <div style="background:#062A5E;border-radius:12px;padding:20px 24px;margin-bottom:24px">
    <h2 style="color:#fff;margin:0;font-size:20px">🎯 Nouveau prospect ${htmlEscape(sSource)}</h2>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:15px">
    <tr><td style="padding:10px 0;color:#666;width:130px;border-bottom:1px solid #f0f0f0">Nom</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0"><strong>${htmlEscape(displayName)}</strong></td></tr>
    <tr><td style="padding:10px 0;color:#666;border-bottom:1px solid #f0f0f0">Téléphone</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0">${htmlEscape(sPhone) || '—'}</td></tr>
    <tr><td style="padding:10px 0;color:#666;border-bottom:1px solid #f0f0f0">Courriel</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0">${htmlEscape(sEmail) || '—'}</td></tr>
    <tr><td style="padding:10px 0;color:#666;border-bottom:1px solid #f0f0f0">Projet</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0">${htmlEscape(sProject) || '—'}</td></tr>
    <tr><td style="padding:10px 0;color:#666">Notes</td><td style="padding:10px 0">${htmlEscape(notes).replace(/\n/g, '<br>') || '—'}</td></tr>
  </table>
  <div style="margin-top:24px;padding:14px 18px;background:#f0f9ff;border-radius:8px;font-size:14px;color:#0369a1">
    Ce prospect est dans <strong>Balenco → Prospects</strong>. Rappelez-le vite — la vitesse de réponse gagne le contrat.
  </div>
</div>`,
        }),
      })
    }
  } catch (_) { /* email is best-effort; the lead is already saved */ }

  return jsonResp({ ok: true, id })
})
