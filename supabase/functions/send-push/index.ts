import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Sends a web push to every subscribed device.
// Called by a DB trigger when a client books online: { record: <appointment row> }
// Manual test from anywhere:                          { test: true }
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  let body: any = {}
  try { body = await req.json() } catch { /* empty body is fine */ }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  webpush.setVapidDetails(
    'mailto:reyesc383@gmail.com',
    Deno.env.get('VAPID_PUBLIC_KEY')!,
    Deno.env.get('VAPID_PRIVATE_KEY')!
  )

  // Build the notification
  let title = 'Balenco'
  let text = ''
  let orgId: string | null = null

  if (body.test === true) {
    title = '🔔 Balenco test'
    text = 'Push notifications are working on this device.'
  } else if (body.record?.id) {
    // Never trust the payload's text — re-fetch the row so a spoofed request
    // can't push arbitrary content to the owner's phone.
    const { data: apt } = await sb.from('appointments')
      .select('id,title,booker_name,start_time,booked_online,org_id')
      .eq('id', body.record.id).maybeSingle()
    if (!apt) {
      return new Response(JSON.stringify({ sent: 0, reason: 'appointment not found' }), {
        status: 404, headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }
    orgId = apt.org_id || null
    const [d, t] = String(apt.start_time || '').split('T')
    const when = d ? `${d} at ${(t || '').slice(0, 5)}` : 'soon'
    title = '📅 New booking request'
    text = `${apt.booker_name || 'A client'} requested "${apt.title}" on ${when}.`
  } else {
    return new Response(JSON.stringify({ error: 'expected { record } or { test: true }' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  let q = sb.from('push_subscriptions').select('endpoint,p256dh,auth')
  if (orgId) q = q.eq('org_id', orgId)
  const { data: subs, error } = await q
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
  if (!subs?.length) {
    return new Response(JSON.stringify({ sent: 0, reason: 'no subscribed devices' }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const payload = JSON.stringify({ title, body: text, url: '/', tag: 'balenco-booking' })
  let sent = 0, pruned = 0
  const failed: string[] = []

  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 86400 }
      )
      sent++
    } catch (e: any) {
      // 404/410 = subscription is dead (app uninstalled, permission revoked) — clean it up
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await sb.from('push_subscriptions').delete().eq('endpoint', s.endpoint)
        pruned++
      } else {
        failed.push(String(e?.statusCode || e?.message || e).slice(0, 120))
      }
    }
  }

  return new Response(JSON.stringify({ sent, pruned, failed }), {
    headers: { ...cors, 'Content-Type': 'application/json' }
  })
})
