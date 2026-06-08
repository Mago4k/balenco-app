import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const { estimate_id, amount, client_id } = await req.json()
  if (!estimate_id || !amount || Number(amount) <= 0) {
    return new Response(JSON.stringify({ error: 'Missing estimate_id or invalid amount.' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // Fetch estimate + settings
  const { data: est } = await sb.from('estimates').select('*').eq('id', estimate_id).single()
  if (!est) {
    return new Response(JSON.stringify({ error: 'Estimate not found.' }), {
      status: 404, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const { data: cfg } = await sb.from('settings').select('company,tps,tvq').eq('org_id', est.org_id).maybeSingle()
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

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })
  const origin  = req.headers.get('origin') || 'https://balenco.app'

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
    metadata: {
      estimate_id,
      client_id: client_id || '',
      type: 'partial_payment',
      amount: String(amtNum),
    },
    success_url: `${origin}/?client=${client_id}&paid=1`,
    cancel_url:  `${origin}/?client=${client_id}`,
  })

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  })
})
