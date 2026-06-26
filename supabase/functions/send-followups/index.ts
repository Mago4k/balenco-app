import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// HTML-escape any client/settings-controlled value before interpolating into email markup.
const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' } as Record<string, string>)[ch])

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
    ? await sb.from('clients').select('id,name,email,portal_token').in('id', clientIds)
    : { data: [] }
  const clientById = new Map((clientRows || []).map((c: any) => [c.id, c]))

  const today = new Date().toISOString().slice(0, 10)
  const fmt = (n: number) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  // Counts only — never return per-record ids / titles / client emails in the
  // HTTP response (this endpoint is reachable without auth; detail = cross-tenant leak).
  let sentCount = 0
  let skippedCount = 0
  let wouldSendCount = 0

  for (const est of candidates || []) {
    const cfg = cfgFor(est.org_id)
    const followupDays = Number(cfg.followup_days ?? 3)
    const ageDays = Math.floor((Date.now() - new Date(est.created_at).getTime()) / 86400000)
    const client = clientById.get(est.client_id)

    if (!client?.email) { skippedCount++; continue }
    if (!onlyId && ageDays < followupDays) { skippedCount++; continue }
    if (!onlyId && est.expiry && est.expiry < today) { skippedCount++; continue }

    if (dryRun) {
      wouldSendCount++
      continue
    }

    const subtotal = Number(est.subtotal || 0)
    const total = subtotal * (1 + Number(cfg.tps ?? 5) / 100 + Number(cfg.tvq ?? 9.975) / 100)
    const deposit = Number(est.deposit || 0)
    const company = cfg.company || 'Balenco'
    // Tokenized portal link — portal-data accepts the unguessable portal_token only.
    const portalLink = `https://balenco.app/?client=${client.portal_token}`

    const html = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background:#062A5E;padding:24px 28px;border-radius:12px 12px 0 0">
    ${cfg.logo ? `<img src="${esc(cfg.logo)}" style="max-height:44px;margin-bottom:10px;display:block" alt="${esc(company)}">` : ''}
    <div style="color:#ffffff;font-size:20px;font-weight:900">${esc(company)}</div>
  </div>
  <div style="padding:24px 28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
    <p style="font-size:16px;color:#334155;margin:0 0 6px">Bonjour <strong>${esc(client.name)}</strong>,</p>
    <p style="font-size:15px;color:#64748b;margin:0 0 20px">Petit suivi concernant la soumission que nous vous avons envoyée${ageDays > 0 ? ` il y a ${ageDays} jours` : ''} — nous aimerions connaître vos commentaires ou répondre à vos questions.</p>
    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;margin-bottom:20px">
      <div style="font-size:17px;font-weight:900;color:#062A5E">${esc(est.title)}</div>
      <div style="font-size:14px;color:#64748b;margin-top:6px">Total : <strong style="color:#0f172a">${fmt(total)}</strong>${deposit > 0 ? ` &nbsp;·&nbsp; Acompte requis pour confirmer : <strong style="color:#0f172a">${fmt(deposit)}</strong>` : ''}</div>
      ${est.expiry ? `<div style="font-size:13px;color:#94a3b8;margin-top:4px">Valide jusqu’au ${est.expiry}</div>` : ''}
    </div>
    <div style="text-align:center;margin:26px 0">
      <a href="${portalLink}" style="background:#062A5E;color:#ffffff;text-decoration:none;padding:15px 34px;border-radius:10px;font-size:15px;font-weight:800;display:inline-block">
        Consulter et approuver votre soumission &rarr;
      </a>
      <div style="margin-top:8px;font-size:12px;color:#94a3b8">Portail client sécurisé &middot; Aucun compte requis</div>
    </div>
    <p style="font-size:14px;color:#64748b;margin:0">Des questions ou besoin d’ajuster quelque chose? Répondez simplement à ce courriel${cfg.phone ? ` ou appelez le ${esc(cfg.phone)}` : ''}.</p>
    <div style="margin-top:18px;padding-top:14px;border-top:1px solid #e2e8f0;font-size:13px;color:#94a3b8;text-align:center">
      ${esc(cfg.email || '')}${cfg.email && cfg.phone ? ' &nbsp;&middot;&nbsp; ' : ''}${esc(cfg.phone || '')}
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
        subject: `Suivi — votre soumission de ${company}`,
        html,
      }),
    })

    if (!sendRes.ok) {
      console.error('follow-up email failed for estimate', est.id, (await sendRes.text()).slice(0, 200))
      skippedCount++
      continue
    }

    await sb.from('estimates').update({ followup_sent: true }).eq('id', est.id)
    await sb.from('logs').insert({
      action: 'Follow-up sent',
      detail: `System emailed ${client.name} about "${est.title}" (${ageDays} days without a response).`,
      user_name: 'System',
      org_id: est.org_id,
    })
    sentCount++
  }

  return new Response(JSON.stringify({ dry_run: dryRun, checked: (candidates || []).length, sent: sentCount, skipped: skippedCount, would_send: wouldSendCount }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  })
})
