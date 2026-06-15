import Stripe from 'https://esm.sh/stripe@14'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Stripe customer billing portal — the owner updates their card, views invoices,
// or cancels. Returns a one-time hosted-portal URL.
//   POST {} -> { url }
const APP_URL = 'https://balenco.app'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (o: unknown, s = 200) =>
    new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

  const sbUser = createClient(
    Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } },
  )
  const { data: { user } } = await sbUser.auth.getUser()
  if (!user) return json({ error: 'Please sign in.' }, 401)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: profile } = await admin.from('profiles').select('org_id, role').eq('id', user.id).maybeSingle()
  const orgId = profile?.org_id
  if (!orgId) return json({ error: 'Your account is not set up yet.' }, 403)
  if (profile?.role !== 'owner') return json({ error: 'Only the account owner can manage billing.' }, 403)

  const { data: sub } = await admin.from('subscriptions').select('stripe_customer_id').eq('org_id', orgId).maybeSingle()
  if (!sub?.stripe_customer_id) return json({ error: 'No billing account yet — subscribe first.' }, 400)

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${APP_URL}/`,
    })
    return json({ url: session.url })
  } catch (e) {
    console.error('billing portal failed', e)
    return json({ error: 'Could not open the billing portal.' }, 502)
  }
})
