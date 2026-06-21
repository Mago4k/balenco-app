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

## Migration log
- **30 — `jobs` table** (2026-06-19, applied live): additive only, 0 rows touched. New `public.jobs` + `assign_job_number()` + `trg_assign_job_number` + RLS `org_members_all`. **Rollback:** run [`20260619_0030_jobs_table_DOWN.sql`](supabase/migrations/20260619_0030_jobs_table_DOWN.sql) (drops table/function/trigger; estimates untouched).
- **31 — `record_job_payment()`** (2026-06-19, applied live): additive new function, mirrors `record_stripe_payment` on `public.jobs`; execute locked to postgres + service_role. **Rollback:** run [`20260619_0031_record_job_payment_DOWN.sql`](supabase/migrations/20260619_0031_record_job_payment_DOWN.sql).
