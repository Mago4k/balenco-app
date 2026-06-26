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

  const { estimate_id, preview } = await req.json()
  if (!estimate_id) {
    return new Response(JSON.stringify({ error: 'Missing estimate_id' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: est } = await sb.from('estimates').select('*').eq('id', estimate_id).single()
  if (!est) {
    return new Response(JSON.stringify({ error: 'Estimate not found' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  if (!est.client_id) {
    return new Response(JSON.stringify({ error: 'No client linked to this estimate' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  // Require an authenticated caller from this estimate's own org —
  // stops anyone with the public key + an estimate UUID from spamming
  // clients (and burning email credits).
  const { data: { user } } = await createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } }
  ).auth.getUser()
  if (!user) {
    return new Response(JSON.stringify({ error: 'Please sign in to send estimates.' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
  const { data: caller } = await sb.from('profiles').select('org_id').eq('id', user.id).single()
  if (!caller?.org_id || caller.org_id !== est.org_id) {
    return new Response(JSON.stringify({ error: 'Not allowed.' }), {
      status: 403, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const [clientRes, cfgRes] = await Promise.all([
    sb.from('clients').select('*').eq('id', est.client_id).single(),
    sb.from('settings').select('*').eq('org_id', est.org_id).maybeSingle(),
  ])

  const client = clientRes.data
  const cfg = cfgRes.data || {}

  if (!client?.email) {
    return new Response(JSON.stringify({ error: 'Client has no email address on file' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const fmt = (n: number) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const subtotal  = Number(est.subtotal || 0)
  const tpsRate   = Number(cfg.tps ?? 5)
  const tvqRate   = Number(cfg.tvq ?? 9.975)
  const tps       = subtotal * tpsRate / 100
  const tvq       = subtotal * tvqRate / 100
  const total     = subtotal + tps + tvq
  const deposit   = Number(est.deposit || 0)
  const company   = cfg.company || 'Balenco'
  // Tokenized portal link — portal-data accepts the unguessable portal_token only.
  const portalLink = `https://balenco.app/?client=${client.portal_token}`

  const items: any[] = est.line_items || []
  const itemRows = items.map((item: any) => `
    <tr>
      <td style="padding:10px 14px;border-top:1px solid #eef2f7;font-size:14px;color:#334155">${esc(item.desc || item.description || '')}</td>
      <td style="padding:10px 14px;border-top:1px solid #eef2f7;font-size:14px;text-align:center;color:#64748b">${item.qty || 1}</td>
      <td style="padding:10px 14px;border-top:1px solid #eef2f7;font-size:14px;text-align:right;color:#64748b">${fmt(Number(item.price || 0))}</td>
      <td style="padding:10px 14px;border-top:1px solid #eef2f7;font-size:14px;text-align:right;font-weight:700;color:#0f172a">${fmt(Number(item.qty || 1) * Number(item.price || 0))}</td>
    </tr>`).join('')

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#ffffff">

  <div style="background:#062A5E;padding:28px 32px;border-radius:12px 12px 0 0">
    ${cfg.logo ? `<img src="${esc(cfg.logo)}" style="max-height:50px;margin-bottom:12px;display:block" alt="${esc(company)}">` : ''}
    <div style="color:#ffffff;font-size:22px;font-weight:900">${esc(company)}</div>
    ${cfg.address ? `<div style="color:#93c5fd;font-size:13px;margin-top:4px">${esc(cfg.address)}</div>` : ''}
    ${cfg.phone   ? `<div style="color:#93c5fd;font-size:13px">${esc(cfg.phone)}</div>` : ''}
  </div>

  <div style="padding:28px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">

    <p style="font-size:16px;color:#334155;margin:0 0 6px">Bonjour <strong>${esc(client.name)}</strong>,</p>
    <p style="font-size:15px;color:#64748b;margin:0 0 24px">Voici votre soumission ci-dessous. Utilisez le bouton au bas pour la consulter et l’approuver.</p>

    <div style="margin-bottom:20px">
      <div style="font-size:20px;font-weight:900;color:#062A5E">${esc(est.title)}</div>
      ${est.scope ? `<div style="font-size:14px;color:#64748b;margin-top:6px;white-space:pre-wrap">${esc(est.scope)}</div>` : ''}
    </div>

    ${items.length ? `
    <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:20px">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:#f8fafc">
            <th style="padding:10px 14px;text-align:left;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px">Description</th>
            <th style="padding:10px 14px;text-align:center;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px">Qté</th>
            <th style="padding:10px 14px;text-align:right;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px">Prix</th>
            <th style="padding:10px 14px;text-align:right;font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:.6px">Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>
    </div>` : ''}

    <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px">
      <table style="width:100%;border-collapse:collapse">
        <tr>
          <td style="padding:11px 16px;font-size:14px;color:#64748b">Sous-total</td>
          <td style="padding:11px 16px;font-size:14px;text-align:right;color:#0f172a">${fmt(subtotal)}</td>
        </tr>
        <tr>
          <td style="padding:11px 16px;font-size:14px;color:#64748b;border-top:1px solid #f1f5f9">TPS (${tpsRate}%)</td>
          <td style="padding:11px 16px;font-size:14px;text-align:right;color:#0f172a;border-top:1px solid #f1f5f9">${fmt(tps)}</td>
        </tr>
        <tr>
          <td style="padding:11px 16px;font-size:14px;color:#64748b;border-top:1px solid #f1f5f9">TVQ (${tvqRate}%)</td>
          <td style="padding:11px 16px;font-size:14px;text-align:right;color:#0f172a;border-top:1px solid #f1f5f9">${fmt(tvq)}</td>
        </tr>
        <tr style="background:#062A5E">
          <td style="padding:13px 16px;font-size:15px;color:#ffffff;font-weight:900">Total</td>
          <td style="padding:13px 16px;font-size:15px;color:#ffffff;font-weight:900;text-align:right">${fmt(total)}</td>
        </tr>
      </table>
    </div>

    ${deposit > 0 ? `
    <div style="background:#eff6ff;border:1px solid #dbeafe;border-radius:10px;padding:14px 18px;margin-bottom:24px">
      <div style="font-size:12px;color:#3b82f6;font-weight:700;text-transform:uppercase;letter-spacing:.5px">Acompte requis pour confirmer</div>
      <div style="font-size:26px;font-weight:900;color:#1d4ed8;margin:6px 0">${fmt(deposit)}</div>
      <div style="font-size:13px;color:#64748b">${esc(est.payment_schedule || 'Dû à l’acceptation')}</div>
    </div>` : ''}

    ${cfg.terms ? `
    <div style="background:#f8fafc;border-radius:10px;padding:14px 18px;margin-bottom:24px">
      <div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Conditions et notes</div>
      <div style="font-size:13px;color:#64748b;white-space:pre-wrap">${esc(cfg.terms)}</div>
    </div>` : ''}

    <div style="text-align:center;margin:32px 0">
      <a href="${portalLink}" style="background:#062A5E;color:#ffffff;text-decoration:none;padding:18px 40px;border-radius:10px;font-size:16px;font-weight:800;display:inline-block">
        ${deposit > 0 ? `Consulter, approuver et payer l’acompte &rarr;` : `Consulter et approuver votre soumission &rarr;`}
      </a>
      <div style="margin-top:10px;font-size:12px;color:#94a3b8">Portail client sécurisé &middot; Aucun compte requis</div>
    </div>

    <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:13px;color:#94a3b8;text-align:center">
      ${cfg.email ? esc(cfg.email) : ''}${cfg.email && cfg.phone ? ' &nbsp;&middot;&nbsp; ' : ''}${cfg.phone ? esc(cfg.phone) : ''}
      ${(cfg.gst_number || cfg.qst_number) ? `<div style="margin-top:6px;font-size:11px;color:#cbd5e1">${cfg.gst_number ? 'TPS/GST: ' + esc(cfg.gst_number) : ''}${cfg.gst_number && cfg.qst_number ? ' &middot; ' : ''}${cfg.qst_number ? 'TVQ/QST: ' + esc(cfg.qst_number) : ''}</div>` : ''}
    </div>

  </div>
</div>`

  // Preview mode: return the rendered HTML without sending (for testing/QA).
  if (preview) {
    return new Response(JSON.stringify({ html }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const sendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Balenco <notifications@mail.balenco.app>',
      to: client.email,
      subject: `Votre soumission de ${company} — ${est.title}`,
      html,
    }),
  })

  if (!sendRes.ok) {
    const errText = await sendRes.text()
    return new Response(JSON.stringify({ error: errText }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  await sb.from('estimates')
    .update({ status: 'Sent', updated_at: new Date().toISOString() })
    .eq('id', estimate_id)
    .neq('status', 'Accepted')

  return new Response(JSON.stringify({ success: true }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  })
})
