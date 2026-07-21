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
  const subtotal  = Number(est.subtotal || 0)
  const tpsRate   = Number(cfg?.tps ?? 5)
  const tvqRate   = Number(cfg?.tvq ?? 9.975)
  const total     = subtotal + subtotal * tpsRate / 100 + subtotal * tvqRate / 100
  const deposit   = Number(est.deposit || 0)
  const paidSoFar = (est.payments || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
  const remaining = Math.max(total - deposit - paidSoFar, 0)
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
    paymentIntentData = { transfer_data: { destination: cfg.stripe_account_id } }
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
