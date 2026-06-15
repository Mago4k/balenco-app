import Stripe from 'https://esm.sh/stripe@14'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// SaaS subscription checkout. The owner picks a plan + interval; we ensure the
// Stripe products/prices exist (idempotent, keyed by lookup_key), create/reuse
// the org's Stripe customer, and open a Checkout Session in subscription mode.
// Any remaining DB-tracked free-trial days are preserved as the Stripe trial_end
// so the customer is not charged until their original 14-day trial ends.
//   POST { plan: 'solo'|'team'|'founding', interval: 'month'|'year' } -> { url }

const CURRENCY = 'cad'
const APP_URL = 'https://balenco.app'
const PLANS = [
  { key: 'solo',     name: 'Balenco Solo',     month: 2900, year: 29000 },
  { key: 'team',     name: 'Balenco Équipe',   month: 6900, year: 69000 },
  { key: 'founding', name: 'Balenco Founding', month: 1900, year: 19000 },
]

async function ensurePrices(stripe: Stripe): Promise<Record<string, string>> {
  const wanted: string[] = []
  for (const p of PLANS) for (const iv of ['month', 'year']) wanted.push(`balenco_${p.key}_${iv}`)
  const found: Record<string, string> = {}
  const list = await stripe.prices.list({ lookup_keys: wanted, active: true, limit: 100 })
  for (const pr of list.data) if (pr.lookup_key) found[pr.lookup_key] = pr.id
  if (Object.keys(found).length === wanted.length) return found
  const products = await stripe.products.list({ limit: 100, active: true })
  for (const p of PLANS) {
    let product = products.data.find((pr) => pr.metadata?.balenco_plan === p.key) || null
    for (const iv of ['month', 'year'] as const) {
      const lk = `balenco_${p.key}_${iv}`
      if (found[lk]) continue
      if (!product) product = await stripe.products.create({ name: p.name, metadata: { balenco_plan: p.key } })
      const price = await stripe.prices.create({
        product: product.id, currency: CURRENCY, unit_amount: (p as Record<string, number>)[iv],
        recurring: { interval: iv }, lookup_key: lk,
      })
      found[lk] = price.id
    }
  }
  return found
}

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

  const body = await req.json().catch(() => ({}))
  const plan = String(body.plan || '')
  const interval = body.interval === 'year' ? 'year' : 'month'
  if (!['solo', 'team', 'founding'].includes(plan)) return json({ error: 'Invalid plan.' }, 400)

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })

  let prices: Record<string, string>
  try { prices = await ensurePrices(stripe) }
  catch (e) { console.error('ensurePrices failed', e); return json({ error: 'Could not set up billing plans.' }, 500) }
  const priceId = prices[`balenco_${plan}_${interval}`]
  if (!priceId) return json({ error: 'Plan price not found.' }, 500)

  const { data: sub } = await admin.from('subscriptions')
    .select('stripe_customer_id, trial_end').eq('org_id', orgId).maybeSingle()

  let customerId = sub?.stripe_customer_id || null
  if (!customerId) {
    const { data: st } = await admin.from('settings').select('email, company').eq('org_id', orgId).maybeSingle()
    const customer = await stripe.customers.create({
      email: st?.email || user.email || undefined,
      name: st?.company || undefined,
      metadata: { org_id: orgId },
    })
    customerId = customer.id
    await admin.from('subscriptions').update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() }).eq('org_id', orgId)
  }

  const subData: Record<string, unknown> = { metadata: { org_id: orgId, plan } }
  const nowSec = Math.floor(Date.now() / 1000)
  const trialEnd = sub?.trial_end ? Math.floor(new Date(sub.trial_end).getTime() / 1000) : 0
  if (trialEnd > nowSec + 60) subData.trial_end = trialEnd

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId!,
      line_items: [{ price: priceId, quantity: 1 }],
      subscription_data: subData as Stripe.Checkout.SessionCreateParams.SubscriptionData,
      client_reference_id: orgId,
      metadata: { org_id: orgId, plan },
      allow_promotion_codes: true,
      success_url: `${APP_URL}/?billing=success`,
      cancel_url: `${APP_URL}/?billing=cancel`,
    })
    return json({ url: session.url, livemode: session.livemode })
  } catch (e) {
    console.error('checkout create failed', e)
    return json({ error: 'Could not start checkout. Try again.' }, 502)
  }
})
