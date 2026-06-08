import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14'

Deno.serve(async (req) => {
  const sig    = req.headers.get('stripe-signature') ?? ''
  const body   = await req.text()
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2023-10-16' })

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(body, sig, secret)
  } catch (err: any) {
    return new Response(`Webhook error: ${err.message}`, { status: 400 })
  }

  if (event.type !== 'checkout.session.completed') {
    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const session    = event.data.object as Stripe.Checkout.Session
  const meta       = session.metadata ?? {}
  const estimateId = meta.estimate_id
  if (!estimateId) {
    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // ── Partial payment (client portal) ──────────────────────────
  if (meta.type === 'partial_payment') {
    const amount    = Number(meta.amount || 0)
    const clientId  = meta.client_id || ''

    // Fetch current payments array and estimate info
    const { data: est } = await sb.from('estimates').select('payments,title,org_id').eq('id', estimateId).single()
    if (!est) return new Response('Estimate not found', { status: 404 })

    const payments = est.payments || []
    payments.push({
      id:     crypto.randomUUID(),
      amount,
      note:   'Online payment',
      date:   new Date().toISOString(),
      by:     'Client (Stripe)',
      stripe_session: session.id,
    })

    await sb.from('estimates').update({ payments }).eq('id', estimateId)

    // Notify owner by email
    const { data: cfg } = await sb.from('settings').select('email,company,tps,tvq').eq('org_id', est.org_id).maybeSingle()
    if (cfg?.email) {
      // Recalculate remaining after this payment
      const { data: fresh } = await sb.from('estimates').select('subtotal,deposit,payments').eq('id', estimateId).single()
      const sub       = Number(fresh?.subtotal || 0)
      const tps       = sub * Number(cfg.tps ?? 5) / 100
      const tvq       = sub * Number(cfg.tvq ?? 9.975) / 100
      const total     = sub + tps + tvq
      const dep       = Number(fresh?.deposit || 0)
      const paidSoFar = (fresh?.payments || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
      const remaining = Math.max(total - dep - paidSoFar, 0)
      const fmt       = (n: number) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Balenco <notifications@balenco.app>',
          to:   cfg.email,
          subject: `💳 Payment received — ${est.title}`,
          html: `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fff">
  <div style="background:#062A5E;border-radius:12px;padding:20px 24px;margin-bottom:24px">
    <h2 style="color:#fff;margin:0;font-size:20px">💳 Payment Received</h2>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:15px">
    <tr><td style="padding:10px 0;color:#666;width:140px;border-bottom:1px solid #f0f0f0">Estimate</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0"><strong>${est.title}</strong></td></tr>
    <tr><td style="padding:10px 0;color:#666;border-bottom:1px solid #f0f0f0">Amount paid</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0"><strong style="color:#10b981">${fmt(amount)}</strong></td></tr>
    <tr><td style="padding:10px 0;color:#666;border-bottom:1px solid #f0f0f0">Remaining balance</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0"><strong style="color:${remaining > 0 ? '#ef4444' : '#10b981'}">${remaining > 0 ? fmt(remaining) : 'Fully paid ✅'}</strong></td></tr>
    <tr><td style="padding:10px 0;color:#666">Stripe session</td><td style="padding:10px 0;font-size:12px;color:#999">${session.id}</td></tr>
  </table>
  <div style="margin-top:24px;padding:14px 18px;background:#f0fdf4;border-radius:8px;font-size:14px;color:#166534">
    Payment has been recorded automatically in Balenco.
  </div>
</div>`,
        }),
      })
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' }
    })
  }

  // ── Deposit payment (estimate approval flow) ──────────────────
  const { data: est } = await sb.from('estimates').select('title,org_id,client_id').eq('id', estimateId).single()
  if (!est) return new Response('Estimate not found', { status: 404 })

  await sb.from('estimates')
    .update({ status: 'Accepted', updated_at: new Date().toISOString() })
    .eq('id', estimateId)
    .neq('status', 'Accepted')

  // Notify owner
  const { data: cfg } = await sb.from('settings').select('email,company').eq('org_id', est.org_id).maybeSingle()
  if (cfg?.email) {
    const amtPaid = session.amount_total ? session.amount_total / 100 : 0
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Balenco <notifications@balenco.app>',
        to:   cfg.email,
        subject: `💳 Deposit received — ${est.title}`,
        html: `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fff">
  <div style="background:#062A5E;border-radius:12px;padding:20px 24px;margin-bottom:24px">
    <h2 style="color:#fff;margin:0;font-size:20px">💳 Deposit Received</h2>
  </div>
  <p style="font-size:15px;color:#333">A deposit of <strong style="color:#10b981">$${amtPaid.toFixed(2)}</strong> was paid for <strong>${est.title}</strong>.</p>
  <p style="font-size:14px;color:#666">The estimate has been marked as Accepted in Balenco.</p>
</div>`,
      }),
    })
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
