import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Daily follow-up sender — called by pg_cron.
// Body (all optional): { dry_run: true } → report only, send nothing
//                      { estimate_id: '...' } → follow up one estimate now (ignores age/expiry)
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  let body: any = {}
  try { body = await req.json() } catch { /* empty body is fine */ }
  const dryRun = body.dry_run === true
  const onlyId = body.estimate_id || null

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Settings: match by org_id, fall back to the 'global' row (org_id is null there)
  const { data: settingsRows } = await sb.from('settings').select('*')
  const globalCfg = (settingsRows || []).find((s: any) => s.id === 'global') || {}
  const cfgFor = (orgId: string) =>
    (settingsRows || []).find((s: any) => s.org_id && s.org_id === orgId) || globalCfg

  let q = sb.from('estimates')
    .select('*')
    .eq('status', 'Sent')
    .or('followup_sent.is.null,followup_sent.eq.false')
    .limit(50)
  if (onlyId) q = q.eq('id', onlyId)
  const { data: candidates, error: qErr } = await q
  if (qErr) {
    return new Response(JSON.stringify({ error: qErr.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const clientIds = [...new Set((candidates || []).map((e: any) => e.client_id).filter(Boolean))]
  const { data: clientRows } = clientIds.length
    ? await sb.from('clients').select('id,name,email').in('id', clientIds)
    : { data: [] }
  const clientById = new Map((clientRows || []).map((c: any) => [c.id, c]))

  const today = new Date().toISOString().slice(0, 10)
  const fmt = (n: number) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const sent: any[] = []
  const skipped: any[] = []

  for (const est of candidates || []) {
    const cfg = cfgFor(est.org_id)
    const followupDays = Number(cfg.followup_days ?? 3)
    const ageDays = Math.floor((Date.now() - new Date(est.created_at).getTime()) / 86400000)
    const client = clientById.get(est.client_id)

    if (!client?.email) { skipped.push({ id: est.id, title: est.title, reason: 'no client email' }); continue }
    if (!onlyId && ageDays < followupDays) { skipped.push({ id: est.id, title: est.title, reason: `only ${ageDays}d old (needs ${followupDays}d)` }); continue }
    if (!onlyId && est.expiry && est.expiry < today) { skipped.push({ id: est.id, title: est.title, reason: 'estimate expired' }); continue }

    if (dryRun) {
      sent.push({ id: est.id, title: est.title, to: client.email, age_days: ageDays, dry_run: true })
      continue
    }

    const subtotal = Number(est.subtotal || 0)
    const total = subtotal * (1 + Number(cfg.tps ?? 5) / 100 + Number(cfg.tvq ?? 9.975) / 100)
    const deposit = Number(est.deposit || 0)
    const company = cfg.company || 'Balenco'
    const portalLink = `https://balenco.app/?client=${est.client_id}`

    const html = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background:#062A5E;padding:24px 28px;border-radius:12px 12px 0 0">
    ${cfg.logo ? `<img src="${cfg.logo}" style="max-height:44px;margin-bottom:10px;display:block" alt="${company}">` : ''}
    <div style="color:#ffffff;font-size:20px;font-weight:900">${company}</div>
  </div>
  <div style="padding:24px 28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
    <p style="font-size:16px;color:#334155;margin:0 0 6px">Hi <strong>${client.name}</strong>,</p>
    <p style="font-size:15px;color:#64748b;margin:0 0 20px">Just following up on the estimate we sent you${ageDays > 0 ? ` ${ageDays} days ago` : ''} — we'd love to hear your thoughts or answer any questions.</p>
    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;margin-bottom:20px">
      <div style="font-size:17px;font-weight:900;color:#062A5E">${est.title}</div>
      <div style="font-size:14px;color:#64748b;margin-top:6px">Total: <strong style="color:#0f172a">${fmt(total)}</strong>${deposit > 0 ? ` &nbsp;·&nbsp; Deposit to confirm: <strong style="color:#0f172a">${fmt(deposit)}</strong>` : ''}</div>
      ${est.expiry ? `<div style="font-size:13px;color:#94a3b8;margin-top:4px">Valid until ${est.expiry}</div>` : ''}
    </div>
    <div style="text-align:center;margin:26px 0">
      <a href="${portalLink}" style="background:#062A5E;color:#ffffff;text-decoration:none;padding:15px 34px;border-radius:10px;font-size:15px;font-weight:800;display:inline-block">
        Review &amp; Approve Your Estimate &rarr;
      </a>
      <div style="margin-top:8px;font-size:12px;color:#94a3b8">Secure client portal &middot; No account required</div>
    </div>
    <p style="font-size:14px;color:#64748b;margin:0">Questions or want to adjust something? Just reply to this email${cfg.phone ? ` or call ${cfg.phone}` : ''}.</p>
    <div style="margin-top:18px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:13px;color:#94a3b8;text-align:center">
      ${cfg.email || ''}${cfg.email && cfg.phone ? ' &nbsp;&middot;&nbsp; ' : ''}${cfg.phone || ''}
    </div>
  </div>
</div>`

    const sendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Balenco <notifications@mail.balenco.app>',
        to: client.email,
        subject: `Following up — your estimate from ${company}`,
        html,
      }),
    })

    if (!sendRes.ok) {
      skipped.push({ id: est.id, title: est.title, reason: 'email failed: ' + (await sendRes.text()).slice(0, 200) })
      continue
    }

    await sb.from('estimates').update({ followup_sent: true }).eq('id', est.id)
    await sb.from('logs').insert({
      action: 'Follow-up sent',
      detail: `System emailed ${client.name} about "${est.title}" (${ageDays} days without a response).`,
      user_name: 'System',
      org_id: est.org_id,
    })
    sent.push({ id: est.id, title: est.title, to: client.email, age_days: ageDays })
  }

  return new Response(JSON.stringify({ dry_run: dryRun, checked: (candidates || []).length, sent, skipped }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  })
})
