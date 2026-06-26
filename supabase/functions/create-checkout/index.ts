import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

  const { data: cfg } = await sb.from('settings').select('company').eq('org_id', est.org_id).maybeSingle()

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })

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
