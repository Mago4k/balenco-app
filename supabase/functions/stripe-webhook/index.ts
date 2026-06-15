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

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  // ── SaaS subscription lifecycle → keep the subscriptions table in sync ──
  if (event.type.startsWith('customer.subscription.')) {
    const subObj = event.data.object as Stripe.Subscription
    const orgId  = subObj.metadata?.org_id
    if (orgId) {
      await sb.from('subscriptions').update({
        status:                 subObj.status,
        plan:                   subObj.metadata?.plan ?? null,
        stripe_subscription_id: subObj.id,
        stripe_customer_id:     typeof subObj.customer === 'string' ? subObj.customer : subObj.customer.id,
        current_period_end:     subObj.current_period_end ? new Date(subObj.current_period_end * 1000).toISOString() : null,
        cancel_at_period_end:   !!subObj.cancel_at_period_end,
        trial_end:              subObj.trial_end ? new Date(subObj.trial_end * 1000).toISOString() : null,
        updated_at:             new Date().toISOString(),
      }).eq('org_id', orgId)
    }
    return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } })
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

  // ── Partial payment (client portal) ──────────────────────────
  if (meta.type === 'partial_payment') {
    const amount    = Number(meta.amount || 0)
    const clientId  = meta.client_id || ''

    // Atomic + idempotent: locks the estimate row, and skips if this Stripe
    // session was already recorded (handles Stripe retries / double delivery).
    const { data: rpc, error: rpcErr } = await sb.rpc('record_stripe_payment', {
      p_estimate_id: estimateId,
      p_amount:      amount,
      p_session:     session.id,
    })
    if (rpcErr)        return new Response(JSON.stringify({ error: rpcErr.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
    if (!rpc?.ok)      return new Response('Estimate not found', { status: 404 })
    if (rpc.duplicate) return new Response(JSON.stringify({ received: true, duplicate: true }), { headers: { 'Content-Type': 'application/json' } })

    // Estimate info for the owner notification
    const { data: est } = await sb.from('estimates').select('title,org_id').eq('id', estimateId).single()
    if (!est) return new Response(JSON.stringify({ received: true }), { headers: { 'Content-Type': 'application/json' } })

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
          from: 'Balenco <notifications@mail.balenco.app>',
          to:   cfg.email,
          subject: `💳 Paiement reçu — ${est.title}`,
          html: `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fff">
  <div style="background:#062A5E;border-radius:12px;padding:20px 24px;margin-bottom:24px">
    <h2 style="color:#fff;margin:0;font-size:20px">💳 Paiement reçu</h2>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:15px">
    <tr><td style="padding:10px 0;color:#666;width:140px;border-bottom:1px solid #f0f0f0">Soumission</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0"><strong>${est.title}</strong></td></tr>
    <tr><td style="padding:10px 0;color:#666;border-bottom:1px solid #f0f0f0">Montant payé</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0"><strong style="color:#10b981">${fmt(amount)}</strong></td></tr>
    <tr><td style="padding:10px 0;color:#666;border-bottom:1px solid #f0f0f0">Solde restant</td><td style="padding:10px 0;border-bottom:1px solid #f0f0f0"><strong style="color:${remaining > 0 ? '#ef4444' : '#10b981'}">${remaining > 0 ? fmt(remaining) : 'Payé en totalité ✅'}</strong></td></tr>
    <tr><td style="padding:10px 0;color:#666">Session Stripe</td><td style="padding:10px 0;font-size:12px;color:#999">${session.id}</td></tr>
  </table>
  <div style="margin-top:24px;padding:14px 18px;background:#f0fdf4;border-radius:8px;font-size:14px;color:#166534">
    Le paiement a été enregistré automatiquement dans Balenco.
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
    .update({ status: 'Accepted', approved_by: 'Client (Stripe)', approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', estimateId)
    .neq('status', 'Accepted')

  const amtPaid = session.amount_total ? session.amount_total / 100 : 0
  const fmt = (n: number) => '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  const { data: cfg } = await sb.from('settings').select('email,company,phone').eq('org_id', est.org_id).maybeSingle()

  // ── Email client confirmation ─────────────────────────────────
  if (est.client_id) {
    const { data: clientRow } = await sb.from('clients').select('name,email').eq('id', est.client_id).single()
    if (clientRow?.email) {
      const portalLink = `https://balenco.app/?client=${est.client_id}`
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Balenco <notifications@mail.balenco.app>',
          to:   clientRow.email,
          subject: `✅ Acompte reçu — ${est.title}`,
          html: `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff">
  <div style="background:#062A5E;padding:28px 32px;border-radius:12px 12px 0 0;text-align:center">
    <div style="font-size:52px;margin-bottom:8px">✅</div>
    <h2 style="color:#fff;margin:0;font-size:22px">Acompte reçu!</h2>
    <p style="color:#93c5fd;margin:8px 0 0;font-size:14px">${cfg?.company || 'Balenco'}</p>
  </div>
  <div style="padding:28px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px">
    <p style="font-size:16px;color:#334155;margin:0 0 8px">Bonjour <strong>${clientRow.name}</strong>,</p>
    <p style="font-size:15px;color:#64748b;margin:0 0 24px">Votre acompte pour <strong>${est.title}</strong> a été reçu et votre soumission est maintenant confirmée. 🎉</p>
    <div style="border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;margin-bottom:24px">
      <table style="width:100%;border-collapse:collapse">
        <tr><td style="padding:12px 16px;font-size:14px;color:#64748b">Soumission</td><td style="padding:12px 16px;font-size:14px;font-weight:700;text-align:right;color:#0f172a">${est.title}</td></tr>
        <tr><td style="padding:12px 16px;font-size:14px;color:#64748b;border-top:1px solid #f1f5f9">Acompte payé</td><td style="padding:12px 16px;font-size:15px;font-weight:900;color:#10b981;text-align:right;border-top:1px solid #f1f5f9">${fmt(amtPaid)}</td></tr>
      </table>
    </div>
    <div style="text-align:center;margin:24px 0">
      <a href="${portalLink}" style="background:#062A5E;color:#fff;text-decoration:none;padding:15px 32px;border-radius:10px;font-size:15px;font-weight:800;display:inline-block">
        Voir votre portail client →
      </a>
      <div style="margin-top:8px;font-size:12px;color:#94a3b8">Suivez votre solde et vos rendez-vous à venir</div>
    </div>
    <div style="font-size:13px;color:#94a3b8;text-align:center;margin-top:16px;padding-top:16px;border-top:1px solid #f1f5f9">
      Des questions? ${cfg?.email || ''}${cfg?.email && cfg?.phone ? ' · ' : ''}${cfg?.phone || ''}
    </div>
  </div>
</div>`,
        }),
      })
    }
  }

  // ── Notify owner ──────────────────────────────────────────────
  if (cfg?.email) {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Balenco <notifications@mail.balenco.app>',
        to:   cfg.email,
        subject: `💳 Acompte reçu — ${est.title}`,
        html: `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;background:#fff">
  <div style="background:#062A5E;border-radius:12px;padding:20px 24px;margin-bottom:24px">
    <h2 style="color:#fff;margin:0;font-size:20px">💳 Acompte reçu</h2>
  </div>
  <p style="font-size:15px;color:#333">Un acompte de <strong style="color:#10b981">${fmt(amtPaid)}</strong> a été payé pour <strong>${est.title}</strong>.</p>
  <p style="font-size:14px;color:#666">La soumission a été marquée comme acceptée dans Balenco.</p>
</div>`,
      }),
    })
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' }
  })
})
