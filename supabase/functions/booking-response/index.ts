import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// HTML-escape any booker/settings-controlled value before interpolating into email markup.
const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' } as Record<string, string>)[ch])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return new Response('Unauthorized', { status: 401, headers: cors })

  const { appointment_id, action } = await req.json()
  if (!appointment_id || !['confirm', 'decline'].includes(action)) {
    return new Response(JSON.stringify({ error: 'Invalid request' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const sbAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )
  const sbUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  )

  // Verify the caller is authenticated
  const { data: { user } } = await sbUser.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401, headers: cors })

  const { data: profile } = await sbAdmin.from('profiles').select('org_id,name').eq('id', user.id).single()
  if (!profile?.org_id) return new Response('No org', { status: 403, headers: cors })

  // Fetch the appointment (must belong to caller's org)
  const { data: appt } = await sbAdmin.from('appointments')
    .select('*').eq('id', appointment_id).eq('org_id', profile.org_id).single()
  if (!appt) return new Response('Appointment not found', { status: 404, headers: cors })

  const newStatus = action === 'confirm' ? 'confirmed' : 'declined'
  await sbAdmin.from('appointments').update({ booking_status: newStatus }).eq('id', appointment_id)

  // Send confirmation/decline email to the client if they gave an email
  if (appt.booker_email) {
    const { data: settings } = await sbAdmin.from('settings')
      .select('company').eq('org_id', profile.org_id).maybeSingle()
    const company = settings?.company ?? 'Your contractor'
    const dateStr = new Date(appt.start_time).toLocaleString('fr-CA', {
      weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
    })
    const isConfirm = action === 'confirm'

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Balenco <notifications@mail.balenco.app>',
        to: appt.booker_email,
        subject: isConfirm
          ? `✅ Rendez-vous confirmé — ${company}`
          : `Mise à jour de votre rendez-vous — ${company}`,
        html: isConfirm ? `
<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:32px;text-align:center;background:#fff">
  <div style="font-size:56px;margin-bottom:16px">✅</div>
  <h2 style="color:#10b981;font-size:26px;margin:0 0 12px">Rendez-vous confirmé!</h2>
  <p style="font-size:16px;color:#333">Bonjour <strong>${esc(appt.booker_name)}</strong>,</p>
  <p style="font-size:15px;color:#333">Votre rendez-vous avec <strong>${esc(company)}</strong> est confirmé :</p>
  <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:10px;padding:16px 24px;margin:20px 0;font-size:17px;font-weight:700;color:#166534">📅 ${dateStr}</div>
  <p style="font-size:13px;color:#888;margin-top:24px">Besoin de reporter? Contactez-nous directement.</p>
</div>` : `
<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:32px;text-align:center;background:#fff">
  <div style="font-size:56px;margin-bottom:16px">😔</div>
  <h2 style="color:#ef4444;font-size:26px;margin:0 0 12px">Toutes nos excuses</h2>
  <p style="font-size:16px;color:#333">Bonjour <strong>${esc(appt.booker_name)}</strong>,</p>
  <p style="font-size:15px;color:#333">Malheureusement, nous ne pouvons pas répondre à votre demande pour le <strong>${dateStr}</strong>.</p>
  <p style="font-size:15px;color:#555">Veuillez nous contacter directement pour trouver une autre plage horaire.</p>
</div>`
      })
    })
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  })
})
