# Balenco — Go-Live Checklist

Everything left between here and opening the doors. Items marked **🔴** are hard
gates; **🟢** are strongly recommended but not blocking.

---

## 0. Right now — cleanup from testing
- [ ] **Cancel the test subscription** so the test card isn't charged on the trial-end date
      (Settings → Subscription → Manage billing → Cancel, **or** Stripe → Customers → `cus_Ui8…` → cancel the subscription).
- [ ] (Optional) Delete the throwaway test account when done (Settings → Danger Zone → Delete).

## 1. 🔴 Security — only you can do these
- [ ] **Rotate the keys that were shared in chat** (treat them as compromised):
  - **Supabase DB password** — Supabase → Project Settings → Database → *Reset database password*; update your local db-tool creds.
  - **Supabase access token** (`sbp_…`) — Supabase → Account → Access Tokens → revoke + create new.
  - **Anthropic API key** — console.anthropic.com → rotate → update the `ANTHROPIC_API_KEY` edge-function secret.
  - (Optional, extra caution) roll the **Stripe webhook signing secret** in Stripe, then re-set `STRIPE_WEBHOOK_SECRET`.
  - [ ] Delete the local `~/.balenco-db-tool/creds.env`.
- [ ] **Enable leaked-password protection** — Supabase → Authentication → turn on "prevent use of leaked passwords."
- [ ] **Turn on PITR / backups** — Supabase → Database → Backups (you're holding customers' business + client data).
- [ ] **Custom SMTP for auth emails** — Supabase → Authentication → SMTP → point at Resend, so password resets / confirmations don't get throttled by the default sender.

## 2. 🔴 Legal — before collecting Québec personal info
- [ ] **Fill the `[BRACKET]` placeholders** in `privacy.html` and `terms.html`: legal business name,
      the *responsable de la protection des renseignements* (name + contact email), mailing address,
      effective date, and the pricing line in Terms.
- [ ] Have a **lawyer or notary** glance over both — especially the Law 25 cross-border (US-hosting)
      disclosure and the privacy-officer designation.

## 3. 💳 Billing — to fully switch on
- [x] Webhook subscription events added.
- [x] Webhook secret + async-crypto fix — done and **tested live end-to-end**.
- [ ] Decide how to apply the **Founding $19** rate to your first ~20 customers (not shown in the UI on
      purpose — apply it manually in Stripe or via a promo code).
- [ ] You are in **live mode** (real charges). Optional: verify a real charge → "Active" by ending a test
      trial in Stripe, then refund.

## 4. 🟢 Strongly recommended (smart, not blocking)
- [ ] **Error monitoring** (e.g. Sentry) + basic analytics — so you see breakage instead of flying blind.
- [ ] **Closed beta** with a handful of real contractors before opening fully (great use of the $19 founding rate; gather testimonials).
- [ ] (Later) CI + a staging environment for safer deploys once you have traction.
- [ ] (Optional) Native Québec-French proofread of the full app + emails.

## 5. Final smoke test — run once on a fresh account before opening
- [ ] Sign up → the Terms consent checkbox blocks until checked.
- [ ] Add a client → create an estimate → mark **Accepted** → the client balance shows the amount owing.
- [ ] **Record a payment** on that estimate → the balance drops.
- [ ] Set company **Payment instructions** → they appear on the invoice.
- [ ] **Online booking** link → a client can request an appointment → it shows in your calendar.
- [ ] **Client portal** link → shows their estimates / balance.
- [ ] **AI estimate** from a photo.
- [ ] **Settings save** → persists after refresh.
- [ ] **Export** → the readable report opens.
- [ ] **Subscribe** → Stripe checkout → back in app; **Manage billing** → cancel.
- [ ] Toggle **FR/EN** and **light/dark** across the app — everything stays translated and themed.

---

## ✅ Already built, deployed & verified (reference)
- Public bilingual landing page
- **Law 25:** Privacy Policy + Terms, consent at signup + booking, data export (readable report + JSON),
  self-serve account deletion, confidentiality-incident register
- Bilingual (Bill 96) FR/EN across the whole app + all emails
- Clean light/dark theme
- Tax-correct estimates (TPS/TVQ) + RBQ/NEQ on documents
- Company settings locked to owner/admin; multi-tenant RLS verified org-scoped
- Interac / cheque payment instructions on invoices
- Client balances derived from accepted estimates + recorded payments
- Fixed a silent data-loss bug (bare Supabase writes) — leads, appointments, settings, deletes, etc. now persist
- **Subscription billing** (Solo $29 / Team $69 / Founding $19, 14-day trial) — built and tested live
- Stripe webhook fixed (async crypto) — also repaired deposit-payment recording
- Service worker is network-first (deploys apply on next reload)
- First-run onboarding checklist
