import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Stripe Connect onboarding for a contractor's OWN payout account (Express).
// Owner-only. Creates (or reuses) the org's connected account, records it on the
// settings row, and returns a Stripe-hosted onboarding link. Client card payments
// are later routed to this account so the money goes to the contractor, not the
// platform. Money never moves here — this only provisions the account + KYC link.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  // Authenticate the caller from their JWT.
  const { data: { user } } = await createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } },
  ).auth.getUser()
  if (!user) return json({ error: 'Please sign in.' }, 401)

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data: profile } = await sb.from('profiles').select('org_id, role').eq('id', user.id).maybeSingle()
  if (!profile?.org_id) return json({ error: 'Your account is not set up yet.' }, 403)
  if (profile.role !== 'owner') return json({ error: 'Only the account owner can set up payouts.' }, 403)
  const orgId = profile.org_id

  const { data: settings } = await sb.from('settings')
    .select('stripe_account_id, email, company').eq('org_id', orgId).maybeSingle()

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })

  // Create (or reuse) the contractor's Express connected account.
  let acctId = settings?.stripe_account_id || null
  if (!acctId) {
    const account = await stripe.accounts.create({
      type: 'express',
      country: 'CA',
      email: settings?.email || user.email || undefined,
      business_profile: settings?.company ? { name: settings.company } : undefined,
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      metadata: { org_id: orgId },
    })
    acctId = account.id
    await sb.from('settings').update({ stripe_account_id: acctId }).eq('org_id', orgId)
  }

  // Refresh the "can this account accept charges yet" flag from Stripe.
  const account = await stripe.accounts.retrieve(acctId)
  const chargesEnabled = !!account.charges_enabled
  await sb.from('settings').update({ stripe_charges_enabled: chargesEnabled }).eq('org_id', orgId)

  if (chargesEnabled) {
    return json({ ok: true, charges_enabled: true })
  }

  // Not fully onboarded yet → return a fresh Stripe-hosted onboarding link.
  const origin = req.headers.get('origin') || 'https://balenco.app'
  const link = await stripe.accountLinks.create({
    account: acctId,
    type: 'account_onboarding',
    refresh_url: `${origin}/?connect=refresh`,
    return_url: `${origin}/?connect=done`,
  })
  return json({ ok: true, charges_enabled: false, url: link.url })
})
