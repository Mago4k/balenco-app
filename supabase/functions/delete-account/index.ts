import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Self-serve account deletion (Law 25 right to erasure / account closure).
// The signed-in OWNER permanently deletes their whole org and every member
// account. The org is resolved from the caller's OWN profile (never from the
// request body), so a caller can only ever delete their own org, and only if
// their role is 'owner'. Personal data is removed before the auth accounts so
// the PII is gone first even if a later step fails.
//   POST { confirm: true } -> { ok: true, deleted: { org, members, photos } }
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  // Identify the caller from their JWT.
  const sb = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } },
  )
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return json({ error: 'Please sign in.' }, 401)

  const body = await req.json().catch(() => ({}))
  if (body.confirm !== true) return json({ error: 'Deletion was not confirmed.' }, 400)

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  // Resolve the caller's org + role from their own profile (authoritative).
  const { data: profile } = await admin.from('profiles').select('org_id, role').eq('id', user.id).maybeSingle()
  const orgId = profile?.org_id
  if (!orgId) return json({ error: 'Your account is not set up yet.' }, 403)
  if (profile?.role !== 'owner') return json({ error: 'Only the account owner can delete the account.' }, 403)

  // Gather what we need BEFORE deleting.
  const { data: members } = await admin.from('profiles').select('id').eq('org_id', orgId)
  const memberIds: string[] = (members ?? []).map((m: any) => m.id)
  const { data: photoRows } = await admin.from('photos').select('storage_path').eq('org_id', orgId)
  const photoPaths: string[] = (photoRows ?? []).map((p: any) => p.storage_path).filter(Boolean)

  // 1) Remove stored photo files (the photo rows themselves cascade with the org).
  if (photoPaths.length) {
    try { await admin.storage.from('photos').remove(photoPaths) } catch (e) { console.error('storage remove failed', e) }
  }

  // 2) Delete org-scoped tables that do NOT cascade from orgs.
  for (const t of ['ai_usage', 'availability', 'push_subscriptions']) {
    const { error } = await admin.from(t).delete().eq('org_id', orgId)
    if (error) console.error('delete ' + t + ' failed', error)
  }

  // 3) Delete the org -> cascades clients, estimates, appointments, leads, logs,
  //    photos, profiles, settings, confidentiality_incidents.
  const { error: orgErr } = await admin.from('orgs').delete().eq('id', orgId)
  if (orgErr) {
    console.error('delete org failed', orgErr)
    return json({ error: 'Could not delete the account data. Nothing was removed from your login.' }, 500)
  }

  // 4) Delete the auth accounts of every member (including the owner).
  let membersDeleted = 0
  for (const id of memberIds) {
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) console.error('deleteUser failed', id, error)
    else membersDeleted++
  }

  return json({ ok: true, deleted: { org: orgId, members: membersDeleted, photos: photoPaths.length } })
})
