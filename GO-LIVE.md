# Balenco — Go-Live Checklist

_Last refreshed 2026-07-27._

**Bottom line:** the app is built, secured, and deployed. Everything that remains is
your **account / legal / business** setup — no more development is required to open.
Items marked **🔴** are hard gates; **🟢** are quick wins; **🟡** need a paid plan.

---

## 🔴 1. Legal — before collecting Québec personal info
- [ ] **Fill the `[BRACKET]` placeholders** in `privacy.html` and `terms.html`:
      legal business name, the *responsable de la protection des renseignements*
      (name + contact email), mailing address, effective date, and the pricing line.
      → *Claude can fill everything except the business name the moment you provide it.*
- [ ] Have a **lawyer or notary** glance at the Law 25 cross-border (US-hosting) disclosure
      and the privacy-officer designation.

## 🔴 2. Business entity (strongly recommended before real customers)
- [ ] Register a business — **sole proprietorship** (fast/cheap) or **incorporate**
      (liability shield). Given you handle client money + Law 25 personal data,
      incorporating before real customers is the safer call. **Talk to a Québec
      comptable** — the tax angles pay for the consult.
- [ ] (Optional but smart) **Tech E&O / cyber-liability insurance.**

## 🟢 3. Quick dashboard toggles (≈2 minutes each)
- [x] **Stripe** `invoice.payment_failed` webhook event — ✅ enabled 2026-07-27 (dunning email live).
- [x] **Resend SMTP** in Supabase Auth — ✅ configured 2026-07-27. *(Also fixed while testing:
      the Supabase Site URL was still the dev default `localhost:3000` → set to `https://balenco.app`;
      and a password-reset recovery bug that silently signed users in — both fixed, reset now works E2E.)*
- [ ] **Stripe** → set your **Google review link** in Settings so the "leave a review"
      card appears for paid clients. *(In-app: Settings → Company.)*
- [ ] (Optional) Enable **BNPL** (Affirm / Klarna / Afterpay) in Stripe — no code needed.
- [ ] Decide how to apply the **Founding $19** rate to your first ~20 customers
      (via a Stripe promo code / manual — intentionally not in the public UI).

## 🟡 4. Needs a Pro-plan upgrade (park until you're ready to pay)
- [ ] **PITR / backups** (you're holding customers' business + client data).
- [ ] **Leaked-password protection** (Supabase → Authentication).

## 🟢 5. Strongly recommended (not blocking)
- [ ] **Error monitoring** (e.g. Sentry) so you see breakage instead of guessing.
- [ ] A small **closed beta** with a few real contractors (great use of the $19 rate).
- [ ] (Later) native Québec-French proofread of the full app + emails.
- [ ] At go-live for OTHER contractors: remove the **`STRIPE_TEST_SECRET_KEY`** secret so
      their Connect payouts use the live key. *(Your own payments are already live.)*

---

## ✅ Security — DONE (rotated + verified 2026-07)
- **DB password** rotated to a strong random value + verified; `creds.env` trimmed to
  just the DB connection (dead access token + Anthropic key removed from it).
- **`sb_secret_` cron key ("balencocron") deleted** — crons run on a vault secret;
  verified still firing after deletion.
- **Anthropic key** + **Supabase access token** rotated.
- Multi-tenant RLS (org-scoped, verified), tokenized portal/approval links, AI usage cap.

## Final smoke test — run once on a fresh account before opening
- [ ] Sign up → the Terms consent checkbox blocks until checked.
- [ ] Add a client → create an estimate → mark **Accepted** → client balance shows owing.
- [ ] **Record a payment** on it → the balance drops.
- [ ] **Good/better/best**: make an estimate with options → open its approval link →
      pick a tier → it approves at that tier's price.
- [ ] Company **Payment instructions** appear on the invoice.
- [ ] **Online booking** link → a client requests an appointment → it hits your calendar.
- [ ] **Client portal** link → shows their estimates / balance.
- [ ] **AI estimate** from a photo.
- [ ] **Accounting CSV** export opens (Settings → Your data) and shows real accents in Excel.
- [ ] **Subscribe** → Stripe checkout → back in app; **Manage billing** → cancel.
- [ ] Toggle **FR/EN** and **light/dark** across the app — everything stays translated + themed.

## ✅ Already built, deployed & verified (reference)
- Public bilingual landing page **with pricing** (Solo $29 / Team $69, 14-day trial)
- **Law 25:** privacy + terms, consent at signup + booking, data export, account deletion,
  confidentiality-incident register
- Bilingual (Bill 96) FR/EN across the whole app + all emails; clean light/dark theme
- Tax-correct estimates (TPS/TVQ) + RBQ/NEQ on documents
- **Good/better/best tiered estimates** (client picks a package on approval)
- **Stripe Connect client-payment routing** — client card payments go to each contractor's
  own connected account; your org collects directly; non-onboarded contractors fail closed
- **Subscription billing** (Solo/Team/Founding, 14-day trial) — tested live
- **Recurring jobs/invoicing**; Interac/cheque payment instructions; review-request card
- **Accounting CSV export**; client status filter-chips; derived client balances
- First-run onboarding + welcome; network-first service worker (deploys apply next reload)
