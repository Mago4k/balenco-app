import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Escape HTML so attacker-controlled booker fields can't inject markup into the
// owner's notification email.
const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
function htmlEscape(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c])
}
// Collapse control chars (defeats subject/header injection) and cap length.
function clean(s: unknown, max: number): string {
  return String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max)
}

// Wall-clock time in America/Montreal -> the matching UTC instant (DST-correct).
function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const m: Record<string, string> = {}
  for (const p of dtf.formatToParts(new Date(utcMs))) m[p.type] = p.value
  const hh = m.hour === '24' ? '00' : m.hour
  const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +hh, +m.minute, +m.second)
  return asUTC - utcMs
}
function montrealToUtc(dateStr: string, timeStr: string): Date {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const [h, mi] = timeStr.split(':').map(Number)
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0)
  const o1 = tzOffsetMs(guess, 'America/Montreal')
  let ts = guess - o1
  const o2 = tzOffsetMs(ts, 'America/Montreal')
  if (o2 !== o1) ts = guess - o2
  return new Date(ts)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const { org_id, date, time, name, email, phone, service_type, notes } = await req.json()
  const sName = clean(name, 120)
  const sEmail = clean(email, 160)
  const sPhone = clean(phone, 40)
  const sService = clean(service_type, 120)
  const sNotes = String(notes ?? '').replace(/\r\n?/g, '\n').trim().slice(0, 1000)
  if (!org_id || !date || !time || !sName) {
    return new Response(JSON.stringify({ error: 'Missing required fields (org_id, date, time, name).' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: avail } = await sb.from('availability').select('*').eq('org_id', org_id).maybeSingle()
  if (!avail?.booking_enabled) {
    return new Response(JSON.stringify({ error: 'Online booking is not available.' }), {
      status: 403, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const start = montrealToUtc(date, time)
  const slotMin: number = avail.slot_minutes
  const end = new Date(start.getTime() + slotMin * 60000)

  // Race-condition check — verify slot is still open
  const { data: conflict } = await sb.from('appointments')
    .select('id')
    .eq('org_id', org_id)
    .neq('booking_status', 'declined')
    .lt('start_time', end.toISOString())
    .gt('end_time', start.toISOString())
    .limit(1)

  if (conflict && conflict.length > 0) {
    return new Response(JSON.stringify({ error: 'That slot was just taken. Please choose another time.' }), {
      status: 409, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  // Find or create a client record for this booker
  let clientId: string | null = null
  if (sEmail) {
    const { data: existing } = await sb.from('clients')
      .select('id').eq('email', sEmail).eq('org_id', org_id).maybeSingle()
    if (existing) {
      clientId = existing.id
    } else {
      const newId = crypto.randomUUID()
      await sb.from('clients').insert({
        id: newId, name: sName, phone: sPhone, email: sEmail,
        status: 'Active', balance: 0, org_id,
        created_by: 'Online Booking', created_at: new Date().toISOString()
      })
      clientId = newId
    }
  }

  const apptId = crypto.randomUUID()
  const { error: apptErr } = await sb.from('appointments').insert({
    id: apptId,
    title: sService || 'Appointment Request',
    client_id: clientId,
    start_time: start.toISOString(),
    end_time: end.toISOString(),
    notes: sNotes,
    location: '',
    booking_status: 'pending',
    booker_name: sName,
    booker_email: sEmail,
    booker_phone: sPhone,
    booked_online: true,
    reminder24: false,
    reminder_sent: false,
    org_id,
    created_by: sName,
    created_at: new Date().toISOString()
  })

  if (apptErr) {
    return new Response(JSON.stringify({ error: apptErr.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  // Email the org owner
  const { data: settings } = await sb.from('settings').select('email,company').eq('org_id', org_id).maybeSingle()
  if (settings?.email) {
    const dateStr = start.toLocaleString('fr-CA', {
      weekday: 'long', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit'
    })
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Balenco <notifications@mail.balenco.app>',
        to: settings.email,
        subject: `📅 Nouvelle demande de réservation — ${sName.slice(0, 80)}`,
        html: `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fff">
  <div style="background:#062A5E;border-radius:12px;padding:20px 24px;margin-bottom:24px">
    <h2 style="color:#fff;margin:0;font-size:20px">📅 Nouvelle demande de réservation en ligne</h2>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:15px">
    <tr><td style="padding:10px 0;color:#666;width:130px;border-bottom:1px solid #f0f0f0">Date et heure</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0"><strong>${dateStr}</strong></td></tr>
    <tr><td style="padding:10px 0;color:#666;border-bottom:1px solid #f0f0f0">Client</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0"><strong>${htmlEscape(sName)}</strong></td></tr>
    <tr><td style="padding:10px 0;color:#666;border-bottom:1px solid #f0f0f0">Service</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0">${htmlEscape(sService) || '—'}</td></tr>
    <tr><td style="padding:10px 0;color:#666;border-bottom:1px solid #f0f0f0">Téléphone</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0">${htmlEscape(sPhone) || '—'}</td></tr>
    <tr><td style="padding:10px 0;color:#666;border-bottom:1px solid #f0f0f0">Courriel</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0">${htmlEscape(sEmail) || '—'}</td></tr>
    <tr><td style="padding:10px 0;color:#666">Notes</td><td style="padding:10px 0">${htmlEscape(sNotes).replace(/\n/g, '<br>') || '—'}</td></tr>
  </table>
  <div style="margin-top:24px;padding:14px 18px;background:#f0f9ff;border-radius:8px;font-size:14px;color:#0369a1">
    Ouvrez <strong>Balenco → Calendrier</strong> pour confirmer ou refuser cette demande. Le client sera avisé automatiquement.
  </div>
</div>`
      })
    })
  }

  return new Response(JSON.stringify({ success: true, appointment_id: apptId }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  })
})
