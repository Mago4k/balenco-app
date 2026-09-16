import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Partial / balance payment checkout (estimate or job). Stripe Connect routing:
//   • Platform owner (Balenco) collects on the platform account — always live key.
//   • Every other contractor's payment is routed to THEIR connected account via a
//     destination charge, so the money is theirs. Not-yet-onboarded contractors
//     can't accept cards (409, fail closed). Connected-account charges use the
//     sandbox key while STRIPE_TEST_SECRET_KEY is set; live once it's removed.
// Platform fee on destination charges, in cents.
//
// Without an application_fee_amount the FULL charge transfers to the contractor
// and Stripe's cut (~2.9% + 30c) is debited from the Balenco platform balance —
// i.e. we were paying roughly $145 out of pocket on a $5,000 deposit. This
// passes that exact cost through to the contractor, so the platform nets zero on
// card payments and the subscription stays the business.
//
// Tunable without a redeploy: PLATFORM_FEE_BPS (basis points, 290 = 2.9%) and
// PLATFORM_FEE_FIXED_CENTS (30). Set PLATFORM_FEE_BPS=0 and
// PLATFORM_FEE_FIXED_CENTS=0 to collect nothing.
//
// Clamped below the charge: Stripe rejects a fee >= the amount, and on a tiny
// payment the fixed 30c alone could approach it.
function platformFeeCents(amountCents: number): number {
  const bps   = Number(Deno.env.get('PLATFORM_FEE_BPS') ?? 290)
  const fixed = Number(Deno.env.get('PLATFORM_FEE_FIXED_CENTS') ?? 30)
  if (!Number.isFinite(bps) || !Number.isFinite(fixed)) return 0
  const fee = Math.round(amountCents * bps / 10000) + fixed
  return Math.max(0, Math.min(fee, Math.max(0, amountCents - 1)))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const { estimate_id, job_id, amount, client_id } = await req.json()
  const isJob    = !!job_id && !estimate_id
  const recordId = isJob ? job_id : estimate_id
  if (!recordId || !amount || Number(amount) <= 0) {
    return new Response(JSON.stringify({ error: 'Missing estimate_id/job_id or invalid amount.' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Fetch the billable record (estimate or job) + settings
  const { data: est } = await sb.from(isJob ? 'jobs' : 'estimates').select('*').eq('id', recordId).single()
  if (!est) {
    return new Response(JSON.stringify({ error: isJob ? 'Job not found.' : 'Estimate not found.' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const { data: cfg } = await sb.from('settings')
    .select('company,tps,tvq, stripe_account_id, stripe_charges_enabled, is_platform_owner')
    .eq('org_id', est.org_id).maybeSingle()
  // Same rule as lib.js calc(): each tax rounded to the cent, total = sum of the
  // rounded parts. Keep these three lines identical everywhere -- a different
  // rounding here shows the client one number in the email and another in the
  // portal. Epsilon because 5.005 is stored just under 5.005 and would round down.
  const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100
  const subtotal  = r2(Number(est.subtotal || 0))
  const tpsRate   = Number(cfg?.tps ?? 5)
  const tvqRate   = Number(cfg?.tvq ?? 9.975)
  const total     = r2(subtotal + r2(subtotal * tpsRate / 100) + r2(subtotal * tvqRate / 100))
  // `deposit` is the amount REQUESTED on the quote, not money received, so it is
  // NOT subtracted here. It used to be, which capped what the client could pay at
  // total-minus-deposit — putting an uncollected deposit permanently out of reach
  // by card (400 "exceeds remaining balance"). Real deposits are recorded as
  // payments (migration 0053) and so are already inside paidSoFar.
  const paidSoFar = (est.payments || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
  const remaining = Math.max(Math.round((total - paidSoFar) * 100) / 100, 0)
  const amtNum    = Number(amount)

  // Guard: can't pay more than what's left (allow 1-cent rounding tolerance)
  if (amtNum > remaining + 0.01) {
    return new Response(JSON.stringify({ error: `Amount exceeds remaining balance of ${remaining.toFixed(2)}.` }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  // Route the money (see header note).
  let paymentIntentData: Record<string, unknown> | undefined
  let stripeKey = Deno.env.get('STRIPE_SECRET_KEY')!
  if (!cfg?.is_platform_owner) {
    if (!cfg?.stripe_account_id || !cfg?.stripe_charges_enabled) {
      return new Response(JSON.stringify({ error: 'This contractor has not finished setting up card payments yet.' }), {
        status: 409, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }
    paymentIntentData = {
      transfer_data: { destination: cfg.stripe_account_id },
      application_fee_amount: platformFeeCents(Math.round(amtNum * 100)),
    }
    stripeKey = Deno.env.get('STRIPE_TEST_SECRET_KEY') || Deno.env.get('STRIPE_SECRET_KEY')!
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2023-10-16' })
  const origin  = req.headers.get('origin') || 'https://balenco.app'

  // Resolve the client's portal token so the post-payment redirect lands on the
  // tokenized portal (portal-data no longer accepts raw client ids).
  let portalToken = ''
  if (client_id) {
    const { data: clientRow } = await sb.from('clients').select('portal_token').eq('id', client_id).single()
    portalToken = clientRow?.portal_token || ''
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    currency: 'cad',
    line_items: [{
      price_data: {
        currency: 'cad',
        product_data: {
          name: `Payment — ${est.title}`,
          description: `${cfg?.company || 'Balenco'} · Partial payment`,
        },
        unit_amount: Math.round(amtNum * 100),
      },
      quantity: 1,
    }],
    ...(paymentIntentData ? { payment_intent_data: paymentIntentData } : {}),
    metadata: isJob ? {
      job_id: recordId,
      client_id: client_id || '',
      type: 'partial_payment',
      kind: 'job',
      amount: String(amtNum),
    } : {
      estimate_id: recordId,
      client_id: client_id || '',
      type: 'partial_payment',
      amount: String(amtNum),
    },
    success_url: portalToken ? `${origin}/?client=${portalToken}&paid=1` : `${origin}/?paid=1`,
    cancel_url:  portalToken ? `${origin}/?client=${portalToken}` : `${origin}/`,
  })

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  })
})
