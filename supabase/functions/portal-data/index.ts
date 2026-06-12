import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Read-only data for the no-login client portal + approval page.
// Runs with the service role and returns ONLY the one client's / one estimate's
// data, so the public tables no longer need an anonymous "read everything" policy.
//   { mode: 'client',   client_id }   -> { client, estimates, appointments, settings }
//   { mode: 'estimate', estimate_id } -> { estimate, client, settings }
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

  const SETTINGS = 'company,logo,address,phone,email,tps,tvq,terms'
  const settingsFor = async (orgId: string | null) => {
    if (orgId) {
      const { data } = await sb.from('settings').select(SETTINGS).eq('org_id', orgId).maybeSingle()
      if (data) return data
    }
    const { data } = await sb.from('settings').select(SETTINGS).eq('id', 'global').maybeSingle()
    return data ?? {}
  }

  if (mode === 'client') {
    const clientId = body.client_id
    if (!clientId) return json({ error: 'Missing client_id' }, 400)

    const { data: client } = await sb.from('clients')
      .select('id,name,phone,email,address,project,status,balance,org_id')
      .eq('id', clientId).maybeSingle()
    if (!client) return json({ error: 'Client not found' }, 404)

    const [{ data: estimates }, { data: appointments }] = await Promise.all([
      sb.from('estimates').select('*').eq('client_id', clientId).order('created_at', { ascending: false }),
      sb.from('appointments').select('id,title,start_time,location,booking_status')
        .eq('client_id', clientId).gte('start_time', new Date().toISOString())
        .order('start_time', { ascending: true }),
    ])

    return json({
      client,
      estimates: estimates ?? [],
      appointments: appointments ?? [],
      settings: await settingsFor(client.org_id),
    })
  }

  if (mode === 'estimate') {
    const estimateId = body.estimate_id
    if (!estimateId) return json({ error: 'Missing estimate_id' }, 400)

    const { data: estimate } = await sb.from('estimates').select('*').eq('id', estimateId).maybeSingle()
    if (!estimate) return json({ error: 'Estimate not found' }, 404)

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
