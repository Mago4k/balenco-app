import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Read-only data for the no-login client portal + approval page.
// Runs with the service role and returns ONLY the one client's / one estimate's
// data. Authorization is by an unguessable per-record token (portal_token /
// approval_token) ONLY — a raw primary key is never accepted, so client and
// estimate ids cannot be used to enumerate records (every row has a token; the
// column defaults generate one, so no link depends on an id fallback).
//   { mode: 'client',   token } -> { client, estimates, jobs, appointments, settings }
//   { mode: 'estimate', token } -> { estimate, client, settings }
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const body = await req.json().catch(() => ({}))
  const mode = body.mode
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  const SETTINGS = 'company,logo,address,phone,email,tps,tvq,terms,gst_number,qst_number,rbq_number,neq_number'
  const settingsFor = async (orgId: string | null) => {
    if (orgId) {
      const { data } = await sb.from('settings').select(SETTINGS).eq('org_id', orgId).maybeSingle()
      if (data) return data
    }
    const { data } = await sb.from('settings').select(SETTINGS).eq('id', 'global').maybeSingle()
    return data ?? {}
  }

  // Strip internal payment metadata (e.g. stripe session ids) before returning.
  const safePayments = (arr: any) => (arr ?? []).map((p: any) => ({ amount: p.amount, date: p.date, note: p.note }))

  const CLIENT_COLS = 'id,name,phone,email,address,project,status,balance,org_id'
  const EST_LIST    = 'id,estimate_number,title,scope,subtotal,deposit,payment_schedule,status,payments,client_id'
  const JOB_LIST    = 'id,job_number,title,scope,subtotal,deposit,payment_schedule,status,payments,client_id'
  const EST_FULL    = 'id,estimate_number,client_id,org_id,title,scope,subtotal,line_items,deposit,payment_schedule,payment_notes,status,expiry,approved_by,approved_at,created_by,created_at,updated_at,payments'

  if (mode === 'client') {
    const key = body.token
    if (!key) return json({ error: 'Missing token' }, 400)

    const { data: client } = await sb.from('clients').select(CLIENT_COLS).eq('portal_token', key).maybeSingle()
    if (!client) return json({ error: 'Client not found' }, 404)

    const [{ data: estimates }, { data: jobs }, { data: appointments }] = await Promise.all([
      sb.from('estimates').select(EST_LIST).eq('client_id', client.id).order('created_at', { ascending: false }),
      sb.from('jobs').select(JOB_LIST).eq('client_id', client.id).order('created_at', { ascending: false }),
      sb.from('appointments').select('id,title,start_time,location,booking_status')
        .eq('client_id', client.id).gte('start_time', new Date().toISOString())
        .order('start_time', { ascending: true }),
    ])
    const safeEstimates = (estimates ?? []).map((e: any) => ({ ...e, payments: safePayments(e.payments) }))
    const safeJobs      = (jobs ?? []).map((j: any) => ({ ...j, payments: safePayments(j.payments) }))

    return json({
      client,
      estimates: safeEstimates,
      jobs: safeJobs,
      appointments: appointments ?? [],
      settings: await settingsFor(client.org_id),
    })
  }

  if (mode === 'estimate') {
    const key = body.token
    if (!key) return json({ error: 'Missing token' }, 400)

    const { data: estimate } = await sb.from('estimates').select(EST_FULL).eq('approval_token', key).maybeSingle()
    if (!estimate) return json({ error: 'Estimate not found' }, 404)
    estimate.payments = safePayments(estimate.payments)

    const { data: client } = estimate.client_id
      ? await sb.from('clients').select('id,name,phone,email,address').eq('id', estimate.client_id).maybeSingle()
      : { data: null }

    return json({
      estimate,
      client: client ?? {},
      settings: await settingsFor(estimate.org_id),
    })
  }

  if (mode === 'join') {
    const token = body.join_token
    if (!token) return json({ error: 'Missing join_token' }, 400)
    const { data: org } = await sb.from('orgs').select('name').eq('join_token', token).maybeSingle()
    if (!org) return json({ error: 'Invalid or expired invite link' }, 404)
    return json({ company: org.name })
  }

  return json({ error: 'Invalid mode (expected "client", "estimate" or "join")' }, 400)
})
