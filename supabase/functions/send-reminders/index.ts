import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// HTML-escape any client/settings-controlled value before interpolating into email markup.
const esc = (value: unknown): string =>
  String(value ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' } as Record<string, string>)[ch]);

const RESEND_KEY = Deno.env.get('RESEND_API_KEY')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

  // Cron-secret gate: hourly pg_cron is the only caller (was verify_jwt=true with
  // the full-access sb_secret_ key embedded in cron.job — now a scoped vault
  // secret validated in-DB via the service-role-only check_cron_secret RPC).
  const { data: cronOk, error: cronErr } = await sb.rpc('check_cron_secret', {
    candidate: req.headers.get('x-cron-secret') ?? '',
  });
  if (cronErr || cronOk !== true) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' }
    });
  }

  // Find appointments starting 23-25 hours from now with reminder not yet sent
  const now = new Date();
  const windowStart = new Date(now.getTime() + 23 * 3600_000).toISOString();
  const windowEnd   = new Date(now.getTime() + 25 * 3600_000).toISOString();

  const [apptRes, settingsRes] = await Promise.all([
    sb.from('appointments')
      .select('*')
      .gte('start_time', windowStart)
      .lte('start_time', windowEnd)
      .eq('reminder24', true)
      .eq('reminder_sent', false),
    sb.from('settings').select('*')
  ]);

  if (apptRes.error) {
    return new Response(JSON.stringify({ error: apptRes.error.message }), { status: 500 });
  }

  const appointments = apptRes.data ?? [];
  // Per-org settings (fall back to the 'global' row) so each tenant's reminder uses
  // its OWN company/phone, not one shared global identity.
  const settingsRows = settingsRes.data ?? [];
  const globalCfg = settingsRows.find((s: any) => s.id === 'global') || {};
  const cfgFor = (orgId: string) => settingsRows.find((s: any) => s.org_id && s.org_id === orgId) || globalCfg;

  if (!appointments.length) {
    return new Response(JSON.stringify({ sent: 0, message: 'No reminders due' }), { status: 200 });
  }

  // Fetch clients for these appointments in one query
  const clientIds = [...new Set(appointments.map((a: any) => a.client_id).filter(Boolean))];
  const { data: clientsData } = await sb.from('clients').select('id,name,email,phone').in('id', clientIds);
  const clientMap: Record<string, any> = Object.fromEntries((clientsData ?? []).map((c: any) => [c.id, c]));

  // Counts only in the HTTP response — never echo client emails back to the caller.
  let sentCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const appt of appointments) {
    const c = clientMap[appt.client_id];

    if (!c?.email) { skippedCount++; continue; }

    const cfg = cfgFor(appt.org_id);
    const company = cfg.company || 'Your Contractor';
    const phone   = cfg.phone   || '';

    const apptDate = new Date(appt.start_time).toLocaleString('en-CA', {
      weekday: 'long', month: 'long', day: 'numeric',
      hour: '2-digit', minute: '2-digit', timeZone: 'America/Toronto'
    });

    const html = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto">
        <div style="background:#062A5E;padding:24px 28px;border-radius:20px 20px 0 0;color:#fff">
          <strong style="font-size:18px">${esc(company)}</strong>
          <p style="margin:4px 0 0;color:#dbeafe;font-size:13px">Appointment Reminder</p>
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-top:0;border-radius:0 0 20px 20px;padding:28px">
          <p style="margin:0 0 16px;color:#0f172a">Hi <strong>${esc(c.name)}</strong>,</p>
          <p style="color:#334155;line-height:1.6;margin:0 0 16px">
            This is a friendly reminder that your appointment is coming up tomorrow:
          </p>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin-bottom:20px">
            <strong style="color:#062A5E;display:block;font-size:16px;margin-bottom:6px">${esc(appt.title)}</strong>
            <span style="color:#475569;font-size:14px">📅 ${apptDate}</span>
            ${appt.location ? `<br><span style="color:#475569;font-size:14px">📍 ${esc(appt.location)}</span>` : ''}
            ${appt.notes ? `<br><span style="color:#64748b;font-size:13px;margin-top:4px;display:block">${esc(appt.notes)}</span>` : ''}
          </div>
          <p style="color:#334155;line-height:1.6;margin:0 0 24px">
            Need to reschedule? ${phone ? `Call us at <strong>${esc(phone)}</strong> or reply` : 'Reply'} to this email.
          </p>
          <p style="color:#94a3b8;font-size:12px;margin:0">— ${esc(company)}</p>
        </div>
      </div>`;

    const emailRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Balenco <notifications@mail.balenco.app>',
        to: c.email,
        subject: `Reminder: ${appt.title} — tomorrow`,
        html
      })
    });

    if (emailRes.ok) {
      await sb.from('appointments').update({ reminder_sent: true }).eq('id', appt.id);
      sentCount++;
    } else {
      console.error('reminder email failed for appointment', appt.id, (await emailRes.text()).slice(0, 200));
      errorCount++;
    }
  }

  return new Response(
    JSON.stringify({ sent: sentCount, skipped: skippedCount, errors: errorCount }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
