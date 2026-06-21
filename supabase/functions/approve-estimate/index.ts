import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// HTML-escape any client/settings-controlled value before interpolating into email markup.
const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' } as Record<string, string>)[ch])

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const { estimate_id, client_id, approved_by } = await req.json()
  if (!estimate_id || !client_id) {
    return new Response(JSON.stringify({ error: 'Missing fields' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Security: verify the estimate actually belongs to this client
  const { data: est } = await sb.from('estimates')
    .select('*').eq('id', estimate_id).eq('client_id', client_id).single()

  if (!est) {
    return new Response(JSON.stringify({ error: 'Estimate not found' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  // Idempotent — already accepted
  if (est.status === 'Accepted') {
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const now = new Date().toISOString()
  await sb.from('estimates').update({
    status: 'Accepted',
    approved_by: approved_by || 'Client',
    approved_at: now,
    updated_at: now,
  }).eq('id', estimate_id)

  const [clientRes, cfgRes] = await Promise.all([
    sb.from('clients').select('*').eq('id', client_id).single(),
    sb.from('settings').select('*').eq('org_id', est.org_id).maybeSingle(),
  ])

  const client = clientRes.data
  const cfg = cfgRes.data || {}
  const company = cfg.company || 'Your contractor'
  const portalLink = `https://balenco.app/?client=${client_id}`

  const fmt = (n: number) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const subtotal = Number(est.subtotal || 0)
  const tps = subtotal * Number(cfg.tps ?? 5) / 100
  const tvq = subtotal * Number(cfg.tvq ?? 9.975) / 100
  const total = subtotal + tps + tvq

  // ── Email client ─────────────────────────────────────────────────
  if (client?.email) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Balenco <notifications@mail.balenco.app>',
        to: client.email,
        subject: `✅ Soumission approuvée — ${est.title}`,
        html: `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff">
  <div style="background:#062A5E;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:52px;margin-bottom:8px">✅</div>
    <h2 style="color:#fff;margin:0;font-size:22px">Soumission approuvée!</h2>
    <p style="color:#93c5fd;margin:8px 0 0;font-size:14px">${esc(company)}</p>
  </div>
  <div style="padding:28px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
    <p style="font-size:16px;color:#334155;margin:0 0 8px">Bonjour <strong>${esc(client.name)}</strong>,</p>
    <p style="font-size:15px;color:#64748b;margin:0 0 24px">Votre soumission a été confirmée. Voici votre résumé :</p>
    <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:12px 16px;font-size:14px;color:#64748b">Soumission</td><td style="padding:12px 16px;font-size:14px;font-weight:700;text-align:right;color:#0f172a">${esc(est.title)}</td></tr>
        <tr style="background:#062A5E"><td style="padding:13px 16px;font-size:15px;color:#fff;font-weight:900">Total</td><td style="padding:13px 16px;font-size:15px;color:#fff;font-weight:900;text-align:right">${fmt(total)}</td></tr>
      </table>
    </div>
    <div style="text-align:center;margin:24px 0">
      <a href="${portalLink}" style="background:#062A5E;color:#fff;text-decoration:none;padding:15px 32px;border-radius:10px;font-size:15px;font-weight:800;display:inline-block">
        Voir votre portail client →
      </a>
      <div style="margin-top:8px;font-size:12px;color:#94a3b8">Suivez les paiements et rendez-vous à venir</div>
    </div>
    <div style="font-size:13px;color:#94a3b8;text-align:center;margin-top:16px;padding-top:16px;border-top:1px solid #f1f5f9">
      Des questions? ${cfg.email ? esc(cfg.email) : ''}${cfg.email && cfg.phone ? ' · ' : ''}${cfg.phone ? esc(cfg.phone) : ''}
    </div>
  </div>
</div>`,
      }),
    })
  }

  // ── Notify owner ─────────────────────────────────────────────────
  if (cfg.email) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Balenco <notifications@mail.balenco.app>',
        to: cfg.email,
        subject: `✅ Soumission approuvée — ${est.title}`,
        html: `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fff">
  <div style="background:#062A5E;border-radius:12px;padding:20px 24px;margin-bottom:24px">
    <h2 style="color:#fff;margin:0;font-size:20px">✅ Soumission approuvée</h2>
  </div>
  <p style="font-size:15px;color:#333">
    <strong>${esc(client?.name || 'Votre client')}</strong> a approuvé <strong>${esc(est.title)}</strong>
    pour <strong style="color:#10b981">${fmt(total)}</strong>.
  </p>
  <p style="font-size:14px;color:#666">La soumission a été marquée comme acceptée dans Balenco.</p>
</div>`,
      }),
    })
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  })
})
