# Restore Anchor — pre-triage-2026-06-19

Known-good rollback point captured before the launch-blocker triage.

## Frontend (GitHub Pages)
- **Prod branch:** `main`, path `/` → serves `balenco.app` (CNAME confirmed).
- **Anchor commit:** `bbdc983a6ed7bbde1ca1d819b29d75e5373650af`
  - _"Profiles: one name per org (migration 29, applied) - employee-isolation stopgap"_, 2026-06-19 15:20 -04:00
- **Local tag:** `pre-triage-2026-06-19` (not pushed).
- **Rollback:** `git reset --hard pre-triage-2026-06-19` (or `git revert <commit>` then push `main`).

## Branch notes
- `deploy-sec` sat exactly at `origin/main` at anchor time (working branch == prod).
- `hardening` (`9a47345`): 7 commits ahead / 76 behind — migrations 1–4, almost certainly already squashed into `main` (now at migration 29). **Do not delete without a content diff.**
- `origin/add-claude-github-actions-1778626950986` (`04a4d9b`): 2 genuinely unmerged commits (CI workflow files) — preserve for Phase 3a.

## Live edge-function versions (Supabase project `wvqqazdzejjksjcjdbcm`)
Revert any function independently by redeploying the version below.

| Function | Version | | Function | Version |
|---|---|---|---|---|
| send-estimate | 22 | | get-slots | 6 |
| approve-estimate | 8 | | create-booking | 9 |
| stripe-webhook | 13 | | booking-response | 7 |
| send-followups | 7 | | create-payment-checkout | 5 |
| create-checkout | 7 | | send-push | 5 |
| send-reminders | 11 | | portal-data | 6 |
| ai-estimate | 5 | | delete-account | 2 |
| create-subscription-checkout | 2 | | billing-portal | 2 |

_Phase 1b will modify: send-estimate (22), approve-estimate (8), stripe-webhook (13), send-followups (7)._

## Phase 1b deploy log (2026-06-19) — HTML-escaping added
Each function was deployed from its **exact live source + `esc()` escaping only** (minimal prod diff). To roll back any one, redeploy the prior version above.

| Function | Pre-triage ver (rollback target) | Now live |
|---|---|---|
| send-estimate | 22 | **23** |
| approve-estimate | 8 | **9** |
| stripe-webhook | 13 | **14** |
| send-followups | 7 | **8** |

Notes: `stripe-webhook` live was CRLF; redeployed as LF to match the repo (runtime-irrelevant). All `verify_jwt` flags preserved (send-estimate=true, others=false).

## Jobs J2 deploy log (2026-06-19) — billing made job-aware
Backward-compatible (`kind:'job'` discriminator; estimate path unchanged). Rollback = redeploy the prior version.

| Function | Prior (rollback) | Now live |
|---|---|---|
| create-payment-checkout | 5 | **6** |
| stripe-webhook | 14 | **15** |
| portal-data | 6 | **7** |

## Phase 2a deploy log (2026-06-26) — portal tokenization + IDOR fix
Closed an IDOR: `portal-data` accepted a raw primary key as a fallback credential, so any
client/estimate UUID granted full portal/approval data on an unauthenticated endpoint. Now
**token-only** (`portal_token` / `approval_token`). All six server-side senders were converted
to emit tokenized links **first**, then the fallback was removed, so no in-flight link breaks.
Each function deployed from **exact live source + the minimal token edit** (some local copies
had drifted behind live; live was authoritative). `verify_jwt` preserved on every function.

| Function | Prior (rollback) | Now live | Change |
|---|---|---|---|
| send-estimate | 23 | **24** | portal link → `portal_token` (verify_jwt=true) |
| approve-estimate | 9 | **10** | portal link → `portal_token` |
| stripe-webhook | 15 | **16** | deposit-confirm link → `portal_token` |
| send-followups | 9 | **10** | portal link → `portal_token` (keeps counts-only leak fix) |
| create-checkout | 7 | **8** | Stripe success/cancel → `approval_token` |
| create-payment-checkout | 6 | **7** | Stripe success/cancel → client `portal_token` (fallback to app root) |
| portal-data | 7 | **8** | removed raw-id fallback (token-only) — **deploy LAST** |

Verified live: `portal-data` with a raw client/estimate id → **404**; with the token → **200**.
Rollback any one by redeploying the prior version above. Frontend `|| id` link fallbacks
(index.html 3690/4494/4737) are now dead code (all rows have tokens) — slated for cleanup in the UX push.

## Phase 2b deploy log (2026-06-26) — revenue protection (plan gate + dunning)
Server-side billing enforcement + failed-payment dunning. The plan gate **mirrors the app's
client `subOk()` exactly** — allow `active`/`past_due`, allow `trialing` only while `trial_end`
is in the future, and **fail OPEN on a missing subscription row** (never lock out on unknown
status). Both live orgs pass today (Balenco trial→2027, longnuts trial→2026-06-29), so nobody
is locked out now; longnuts correctly gates after their trial ends.

| Function | Prior (rollback) | Now live | Change |
|---|---|---|---|
| ai-estimate | 5 | **6** | server plan gate before spending the Anthropic key (402 if lapsed) |
| send-estimate | 24 | **25** | server plan gate before sending email (402 if lapsed) |
| stripe-webhook | 16 | **17** | new `invoice.payment_failed` handler → dunning email to owner |

NOT gated on purpose: `create-checkout` / `create-payment-checkout` (client-initiated payments —
blocking them would block the contractor's incoming money). Rollback any one by redeploying the
prior version.

> ⚠️ **Carlos — Stripe config needed for dunning:** the webhook only receives `invoice.payment_failed`
> if that event is enabled on the Balenco webhook endpoint in the Stripe Dashboard
> (Developers → Webhooks → your endpoint → "Select events"). Add `invoice.payment_failed`
> (and optionally `invoice.payment_succeeded`) or the dunning handler is dead code.

## Phase 3 audit-fix log (2026-07-07) — fresh 3-agent security/bug audit + fixes
Full re-audit (frontend / edge fns / DB, cross-verified against live). Applied + live:

**Frontend (index.html, SW v63→v64, commit 543cb1a):**
- **[HIGH] Jobs could never be deleted** — `deleteItem`'s table map omitted `jobs`, so a
  "deleted" job stayed in the DB and resurrected on the next realtime refetch, permanently
  inflating revenue/tax/every balance. Added `jobs` to the delete map + the realtime channel.
- `convertLead` rewritten write-first (a failed client insert can't orphan a "Won" lead).
- `emailEstimate` no longer locally downgrades an Accepted estimate to Sent (revenue flicker).
- Booking-page logo escaped; CSV export formula-injection guard; photo-upload-failure no
  longer creates an empty record + false "saved" toast.

**Edge (`send-reminders` 11→12):** was deployed-only (no local file = the drift source). Added
`esc()` on all email fields, **per-org settings** (was global-only → cross-tenant branding leak +
wrong From), verified sending domain, counts-only response. Local file created. verify_jwt=true kept.

**DB (migration `20260707_0034`, applied live + verified):** `record_manual_payment` now rejects
non-positive amounts (the one payment RPC callable directly by authenticated users);
`jobs` got `UNIQUE(org_id, job_number)` to match estimates. **Rollback:** run the `_DOWN.sql`.

**Declined (agent-suggested but UNSAFE):** revoking `authenticated` EXECUTE on
`current_org_id`/`current_user_name`/`current_user_role` — they're invoked *inside RLS policies*,
so revoking would lock every authenticated user out of every table. Left as-is (they only ever
return the caller's own org/name/role). The advisor warning is a false-positive for this pattern.

## Cron-secret deploy log (2026-07-17) — scoped auth for cron/trigger endpoints
The full-access `sb_secret_…` key was stored in **plaintext in `cron.job` commands** (and the
`send-followups-daily` job's headers were invalid JSON — that job had **failed every run since
creation**, so follow-up automation had never actually fired). `notify_new_booking` called
`send-push` with **no auth at all**. New model: a 256-bit secret lives only in **vault**
(`cron_secret`); cron jobs + the booking trigger read it from vault at call time (never stored
in `cron.job`); the three functions validate it via the service-role-only `check_cron_secret()`
RPC (secret never leaves Postgres) and 401 otherwise.

| Function | Prior (rollback) | Now live | Change |
|---|---|---|---|
| send-followups | 10 | **11** | `x-cron-secret` gate (verify_jwt=false kept) |
| send-reminders | 12 | **13** | `x-cron-secret` gate; **verify_jwt true→false** (old auth was the embedded master key) |
| send-push | 6 | **7** | `x-cron-secret` gate (verify_jwt=false kept) |

Also: `cron.alter_job(2)` + `cron.alter_job(3)` rewrote both job commands (valid JSON, vault
header read, no embedded key), and migration 0035 replaced `notify_new_booking`. Verified live:
all three fns → 401 with no/wrong secret; correct secret → follow-ups dry-run 200, reminders 200,
push 404 on bogus id; the in-DB `net.http_post` path (what cron executes) → 200.
**Rollback:** redeploy prior versions + run `20260717_0035_cron_secret_gate_DOWN.sql` + restore
the old cron commands (they'd need a working key — the master key should be rotated by then).

> ✅ **Carlos — the `sb_secret_` key is no longer used anywhere.** Nothing in the DB, cron, or
> functions references it now, so you can rotate/disable it in the Dashboard (Settings → API keys)
> whenever ready. The old `sbp_` access token already appears rotated (the CLI rejects it) — the
> **DB password and ANTHROPIC_API_KEY from the old creds file are still valid and still need rotation.**

## Review-request + portal payment-instructions (2026-07-17)
| Function | Prior (rollback) | Now live | Change |
|---|---|---|---|
| portal-data | 8 | **9** | settings whitelist adds `payment_instructions` + `review_link` (verify_jwt=false kept) |

Frontend (SW v69): Settings gets a "Google review link" field (`settings.review_link`,
migration 0036); the client portal shows the owner's Interac/cheque instructions while a
balance is owing, and a "Leave a Google review" card once everything billable is fully paid
(only when a valid http(s) `review_link` is set — no org has one yet, so no visual change
until the owner fills the field).

## Recurring billing on jobs (2026-07-17)
New edge fn **generate-recurring-jobs v1** (verify_jwt=false, x-cron-secret gated) + cron job 4
(`generate-recurring-jobs-daily`, 09:30 UTC, vault-header command like jobs 2/3) + migration 0037
(jobs.recurring/recurring_end/recurring_parent_id/next_recurrence) + frontend (SW v70): recurring
checkbox on the Add-a-job form (weekly / every-2-weeks / monthly + optional end date), ↻ badge +
next date on template rows, "Stop recurrence" row action, clones labelled "Auto-generated".
Clones: deposit 0, payments [], own atomic job_number, created_by System; client is emailed a
French invoice email with their tokenized portal payment link (skipped if no email). Plan gate
mirrors subOk (fail-open, skip+advance for lapsed orgs). **E2E-verified live** with a synthetic
org: template advanced +1 month, clone #1002 created with parent link + log entry; 401 without
secret; dry-run counts-only; test org fully deleted.
**Rollback:** unschedule cron 4, delete the fn, run `20260717_0037_recurring_jobs_DOWN.sql`,
revert the frontend commit.

## Realtime fixed for real (2026-08-17) — Sentry crash + dead live-sync
Sentry (prod): `cannot add postgres_changes callbacks for realtime:app-changes after subscribe()`
at startRealtime. Two distinct bugs:
1. **Re-login crash (frontend, SW v84):** `sb.channel(name)` returns the EXISTING instance once
   created, so a second `startSession` (sign out → sign in, duplicate auth event) re-attached
   listeners to a subscribed channel → throw, and the billing/Connect return handlers after
   `startRealtime()` were skipped. Fix: track `_rtChannel`, remove the old channel on re-start
   AND on logout (`backToLogin`), unique topic per session (`app-changes-<ts>`).
2. **Live sync was silently DEAD since launch:** the `supabase_realtime` publication contained
   **zero tables** — subscriptions succeeded, no events were ever delivered; data only refreshed
   on reload. Migration 0043 adds the 7 tables the app listens to (RLS-filtered delivery).
Verified in the real app UI: login → logout → login clean (no throw, zero console errors);
server-side insert → app auto-refetched (client count updated live, no reload). Note: the
realtime service takes a little while to notice publication changes — a subscription created
immediately after the alter received nothing; after reload + settle, events flowed.

## Migration log
- **43 — realtime publication tables** (2026-08-17, applied live): adds clients/leads/estimates/appointments/photos/jobs/logs to `supabase_realtime`. **Rollback:** [`20260817_0043_realtime_publication_tables_DOWN.sql`](supabase/migrations/20260817_0043_realtime_publication_tables_DOWN.sql).
- **37 — recurring jobs** (2026-07-17, applied live): additive columns + partial index on `jobs`. **Rollback:** [`20260717_0037_recurring_jobs_DOWN.sql`](supabase/migrations/20260717_0037_recurring_jobs_DOWN.sql).
- **36 — `settings.review_link`** (2026-07-17, applied live): additive column. **Rollback:** [`20260717_0036_settings_review_link_DOWN.sql`](supabase/migrations/20260717_0036_settings_review_link_DOWN.sql).
- **30 — `jobs` table** (2026-06-19, applied live): additive only, 0 rows touched. New `public.jobs` + `assign_job_number()` + `trg_assign_job_number` + RLS `org_members_all`. **Rollback:** run [`20260619_0030_jobs_table_DOWN.sql`](supabase/migrations/20260619_0030_jobs_table_DOWN.sql) (drops table/function/trigger; estimates untouched).
- **31 — `record_job_payment()`** (2026-06-19, applied live): additive new function, mirrors `record_stripe_payment` on `public.jobs`; execute locked to postgres + service_role. **Rollback:** run [`20260619_0031_record_job_payment_DOWN.sql`](supabase/migrations/20260619_0031_record_job_payment_DOWN.sql).
- **35 — `check_cron_secret()` + authenticated `notify_new_booking`** (2026-07-17, applied live as version `20260717145153`): additive gate RPC (service-role-only, reads vault) + booking trigger now sends the vault secret to send-push. Local file renumbered 0035 (0033 = the 2026-06-25 security-audit migration after de-duplicating the double 0032; 0034 = money-integrity). **Rollback:** [`20260717_0035_cron_secret_gate_DOWN.sql`](supabase/migrations/20260717_0035_cron_secret_gate_DOWN.sql) — only together with redeploying the pre-gate fn versions.
- **32 — `record_manual_payment()` + grant lockdown** (2026-06-20, applied live): additive SECURITY INVOKER fn for atomic manual cash/cheque payments (estimate + job), idempotent by client payment id; closes a read-modify-write lost-update. Also revoked anon/authenticated EXECUTE on `assign_job_number` + `create_trial_subscription` (advisor fix). **Rollback:** [`20260620_0032_record_manual_payment_DOWN.sql`](supabase/migrations/20260620_0032_record_manual_payment_DOWN.sql) (drops the fn; grant revokes are intentional, not reversed).
