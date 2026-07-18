import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// HTML-escape any client/settings-controlled value before interpolating into email markup.
const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' } as Record<string, string>)[ch])

// Daily recurring-billing generator — called by pg_cron.
// A job with recurring != '' is a template: clone it each period (deposit 0,
// payments [], recurring ''), advance next_recurrence, email the client their
// tokenized portal payment link. Body { dry_run: true } -> report only.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  let body: any = {}
  try { body = await req.json() } catch { /* empty body is fine */ }
  const dryRun = body.dry_run === true

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Cron-secret gate (same model as send-followups/send-reminders/send-push).
  const { data: cronOk, error: cronErr } = await sb.rpc('check_cron_secret', {
    candidate: req.headers.get('x-cron-secret') ?? '',
  })
  if (cronErr || cronOk !== true) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const today = new Date().toISOString().slice(0, 10)

  const { data: due, error: qErr } = await sb.from('jobs')
    .select('*')
    .neq('recurring', '')
    .lte('next_recurrence', today)
    .limit(50)
  if (qErr) {
    return new Response(JSON.stringify({ error: qErr.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  // Per-org settings + plan status (mirror the app's subOk: allow active /
  // past_due / trialing-with-future-trial_end; FAIL OPEN on no row).
  const orgIds = [...new Set((due || []).map((j: any) => j.org_id).filter(Boolean))]
  const [{ data: settingsRows }, { data: subRows }] = await Promise.all([
    sb.from('settings').select('*'),
    orgIds.length ? sb.from('subscriptions').select('org_id,status,trial_end').in('org_id', orgIds) : Promise.resolve({ data: [] }),
  ])
  const globalCfg = (settingsRows || []).find((s: any) => s.id === 'global') || {}
  const cfgFor = (orgId: string) =>
    (settingsRows || []).find((s: any) => s.org_id && s.org_id === orgId) || globalCfg
  const planOk = (orgId: string) => {
    const s = (subRows || []).find((r: any) => r.org_id === orgId)
    if (!s) return true
    if (s.status === 'active' || s.status === 'past_due') return true
    if (s.status === 'trialing') return !s.trial_end || new Date(s.trial_end).getTime() > Date.now()
    return false
  }

  const clientIds = [...new Set((due || []).map((j: any) => j.client_id).filter(Boolean))]
  const { data: clientRows } = clientIds.length
    ? await sb.from('clients').select('id,name,email,portal_token').in('id', clientIds)
    : { data: [] }
  const clientById = new Map((clientRows || []).map((c: any) => [c.id, c]))

  const addInterval = (iso: string, freq: string): string => {
    const d = new Date(iso + 'T00:00:00Z')
    if (freq === 'weekly') d.setUTCDate(d.getUTCDate() + 7)
    else if (freq === 'biweekly') d.setUTCDate(d.getUTCDate() + 14)
    else d.setUTCMonth(d.getUTCMonth() + 1)
    return d.toISOString().slice(0, 10)
  }
  const fmt = (n: number) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  // Counts only in the HTTP response — never echo client emails / titles back.
  let created = 0, emailed = 0, stopped = 0, skippedPlan = 0, wouldCreate = 0, errors = 0

  for (const job of due || []) {
    // Series past its end date -> stop the template, create nothing.
    if (job.recurring_end && job.next_recurrence > job.recurring_end) {
      if (!dryRun) await sb.from('jobs').update({ recurring: '', next_recurrence: null }).eq('id', job.id)
      stopped++
      continue
    }
    // Lapsed plan -> skip this period (advance so no backlog piles up).
    if (!planOk(job.org_id)) {
      if (!dryRun) {
        const next = addInterval(job.next_recurrence || today, job.recurring)
        await sb.from('jobs').update({ next_recurrence: next }).eq('id', job.id)
      }
      skippedPlan++
      continue
    }
    if (dryRun) { wouldCreate++; continue }

    const clone = {
      client_id: job.client_id,
      org_id: job.org_id,
      title: job.title,
      scope: job.scope,
      line_items: job.line_items || [],
      subtotal: job.subtotal,
      deposit: 0,
      payments: [],
      payment_schedule: job.payment_schedule,
      payment_notes: job.payment_notes,
      status: 'Active',
      recurring: '',
      recurring_parent_id: job.recurring_parent_id || job.id,
      created_by: 'System',
      created_at: new Date().toISOString(),
    }
    const { data: inserted, error: insErr } = await sb.from('jobs').insert(clone).select('id,job_number').single()
    if (insErr || !inserted) {
      console.error('recurring clone failed for job', job.id, insErr?.message)
      errors++
      continue
    }
    created++

    // Advance the template's schedule; stop the series if it just passed its end.
    let next: string | null = addInterval(job.next_recurrence || today, job.recurring)
    const stillRecurring = !job.recurring_end || next <= job.recurring_end ? job.recurring : ''
    if (!stillRecurring) next = null
    await sb.from('jobs').update({ recurring: stillRecurring, next_recurrence: next }).eq('id', job.id)

    await sb.from('logs').insert({
      action: 'Recurring job created',
      detail: `System created recurring job #${inserted.job_number} "${job.title}" (${job.recurring}).`,
      user_name: 'System',
      org_id: job.org_id,
    })

    // Email the client their payment link (French-first like every client email).
    const client = clientById.get(job.client_id)
    if (!client?.email || !client?.portal_token) continue
    const cfg = cfgFor(job.org_id)
    const subtotal = Number(job.subtotal || 0)
    const total = subtotal * (1 + Number(cfg.tps ?? 5) / 100 + Number(cfg.tvq ?? 9.975) / 100)
    const company = cfg.company || 'Balenco'
    const portalLink = `https://balenco.app/?client=${client.portal_token}`

    const html = `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#ffffff">
  <div style="background:#062A5E;padding:24px 28px;border-radius:12px 12px 0 0">
    ${cfg.logo ? `<img src="${esc(cfg.logo)}" style="max-height:44px;margin-bottom:10px;display:block" alt="${esc(company)}">` : ''}
    <div style="color:#ffffff;font-size:20px;font-weight:900">${esc(company)}</div>
  </div>
  <div style="padding:24px 28px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
    <p style="font-size:16px;color:#334155;margin:0 0 6px">Bonjour <strong>${esc(client.name)}</strong>,</p>
    <p style="font-size:15px;color:#64748b;margin:0 0 20px">Votre nouvelle facture est prête.</p>
    <div style="border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;margin-bottom:20px">
      <div style="font-size:17px;font-weight:900;color:#062A5E">${esc(job.title)}</div>
      <div style="font-size:14px;color:#64748b;margin-top:6px">Total (taxes incluses) : <strong style="color:#0f172a">${fmt(total)}</strong></div>
    </div>
    <div style="text-align:center;margin:26px 0">
      <a href="${portalLink}" style="background:#062A5E;color:#ffffff;text-decoration:none;padding:15px 34px;border-radius:10px;font-size:15px;font-weight:800;display:inline-block">
        Consulter et payer en ligne &rarr;
      </a>
      <div style="margin-top:8px;font-size:12px;color:#94a3b8">Portail client sécurisé &middot; Aucun compte requis</div>
    </div>
    <p style="font-size:14px;color:#64748b;margin:0">Des questions? Répondez simplement à ce courriel${cfg.phone ? ` ou appelez le ${esc(cfg.phone)}` : ''}.</p>
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
        subject: `Votre facture — ${company}`,
        html,
      }),
    })
    if (sendRes.ok) emailed++
    else console.error('recurring invoice email failed for job', inserted.id, (await sendRes.text()).slice(0, 200))
  }

  return new Response(JSON.stringify({ dry_run: dryRun, checked: (due || []).length, created, emailed, stopped, skipped_plan: skippedPlan, would_create: wouldCreate, errors }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  })
})
