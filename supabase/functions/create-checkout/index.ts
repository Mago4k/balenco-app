import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Deposit-on-approval checkout. Stripe Connect routing:
//   • Platform owner (Balenco) collects on the platform account — always live key.
//   • Every other contractor's deposit is routed to THEIR connected account via a
//     destination charge (transfer_data.destination), so the money is theirs. A
//     contractor who hasn't finished payout onboarding can't accept cards yet — we
//     fail closed (409) rather than silently bank their client's money on the
//     platform. Connected-account charges use the sandbox key while
//     STRIPE_TEST_SECRET_KEY is set; remove it at go-live and they use STRIPE_SECRET_KEY.
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const { estimate_id } = await req.json()
  if (!estimate_id) {
    return new Response(JSON.stringify({ error: 'Missing estimate_id.' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: est } = await sb.from('estimates').select('*').eq('id', estimate_id).single()
  if (!est) {
    return new Response(JSON.stringify({ error: 'Estimate not found.' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const depositAmount = Number(est.deposit || 0)
  if (depositAmount <= 0) {
    return new Response(JSON.stringify({ error: 'No deposit amount set on this estimate.' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const { data: cfg } = await sb.from('settings')
    .select('company, stripe_account_id, stripe_charges_enabled, is_platform_owner')
    .eq('org_id', est.org_id).maybeSingle()

  // Route the money (see header note).
  let paymentIntentData: Record<string, unknown> | undefined
  let stripeKey = Deno.env.get('STRIPE_SECRET_KEY')!
  if (!cfg?.is_platform_owner) {
    if (!cfg?.stripe_account_id || !cfg?.stripe_charges_enabled) {
      return new Response(JSON.stringify({ error: 'This contractor has not finished setting up card payments yet.' }), {
        status: 409, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }
    paymentIntentData = { transfer_data: { destination: cfg.stripe_account_id } }
    stripeKey = Deno.env.get('STRIPE_TEST_SECRET_KEY') || Deno.env.get('STRIPE_SECRET_KEY')!
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    currency: 'cad',
    line_items: [{
      price_data: {
        currency: 'cad',
        product_data: {
          name: `Deposit — ${est.title}`,
          description: `${cfg?.company || 'Balenco'} · Deposit to confirm your estimate`,
        },
        unit_amount: Math.round(depositAmount * 100),
      },
      quantity: 1,
    }],
    ...(paymentIntentData ? { payment_intent_data: paymentIntentData } : {}),
    metadata: {
      estimate_id,
      type: 'deposit',
    },
    success_url: `https://balenco.app/?approve=${est.approval_token}&paid=1`,
    cancel_url:  `https://balenco.app/?approve=${est.approval_token}`,
  })

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  })
})
