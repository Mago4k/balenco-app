import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const { org_id, week_start } = await req.json()
  if (!org_id || !week_start) {
    return new Response(JSON.stringify({ error: 'Missing org_id or week_start' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  const { data: avail } = await sb.from('availability').select('*').eq('org_id', org_id).maybeSingle()
  if (!avail?.booking_enabled) {
    return new Response(JSON.stringify({ error: 'Online booking is not available for this company.' }), {
      status: 400, headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }

  const { data: settings } = await sb.from('settings').select('company,logo').eq('org_id', org_id).maybeSingle()

  // Build week range (Monday 00:00 → Sunday+1 00:00)
  const monday = new Date(week_start + 'T00:00:00')
  const nextMonday = new Date(monday)
  nextMonday.setDate(nextMonday.getDate() + 7)

  // Fetch existing (non-declined) appointments in this week
  const { data: appts } = await sb.from('appointments')
    .select('start_time,end_time,booking_status')
    .eq('org_id', org_id)
    .neq('booking_status', 'declined')
    .gte('start_time', monday.toISOString())
    .lt('start_time', nextMonday.toISOString())

  const now = new Date()
  const cutoff = new Date(now.getTime() + 60 * 60 * 1000) // 1-hour buffer from now
  const slots: Record<string, string[]> = {}

  for (let d = 0; d < 7; d++) {
    const day = new Date(monday)
    day.setDate(day.getDate() + d)
    const dow = day.getDay() // 0=Sun … 6=Sat

    if (!(avail.working_days as number[]).includes(dow)) continue

    const dateKey = day.toISOString().slice(0, 10)
    const [sh, sm] = (avail.start_time as string).split(':').map(Number)
    const [eh, em] = (avail.end_time as string).split(':').map(Number)
    const startMin = sh * 60 + sm
    const endMin = eh * 60 + em
    const slotMin: number = avail.slot_minutes

    const daySlots: string[] = []

    for (let m = startMin; m + slotMin <= endMin; m += slotMin) {
      const slotStart = new Date(day)
      slotStart.setHours(Math.floor(m / 60), m % 60, 0, 0)
      if (slotStart <= cutoff) continue // skip past/near-future slots

      const slotEnd = new Date(slotStart.getTime() + slotMin * 60000)
      const busy = (appts ?? []).some(a => {
        const as = new Date(a.start_time)
        const ae = a.end_time ? new Date(a.end_time) : new Date(as.getTime() + slotMin * 60000)
        return slotStart < ae && slotEnd > as
      })
      if (!busy) {
        daySlots.push(
          String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
        )
      }
    }
    if (daySlots.length) slots[dateKey] = daySlots
  }

  return new Response(
    JSON.stringify({ settings: settings ?? { company: 'Book an Appointment', logo: '' }, slots }),
    { headers: { ...cors, 'Content-Type': 'application/json' } }
  )
})
