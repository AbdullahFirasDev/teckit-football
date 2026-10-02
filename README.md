# Eventra — All-in-One Events & Ticketing Platform

Sell tickets, issue them instantly on payment, check attendees in with an
in-browser QR scanner, and watch sales/attendance live. No email or WhatsApp
services by design — zero notification costs.

## Stack

| Concern             | Choice                                            |
| ------------------- | ------------------------------------------------- |
| Framework           | Next.js 15 (App Router, TypeScript, Tailwind v4)  |
| Database / backend  | Supabase (PostgreSQL + RLS + Postgres RPCs)       |
| Data fetching       | `@tanstack/react-query` + `@supabase/supabase-js` |
| Payments            | Wayl hosted checkout + signed webhooks            |
| QR rendering        | `qrcode.react`                                    |
| QR scanning         | `html5-qrcode` (in-browser camera, no app)        |
| Tickets PDF         | `@react-pdf/renderer`                             |

## Setup

1. **Supabase** — create a project, then run both migrations in the SQL editor
   (idempotent, in order):
   - `supabase/migrations/0001_init.sql` — tables, atomic RPCs
     (`purchase_ticket`, `issue_tickets_for_order`, `check_in_ticket`), RLS.
   - `supabase/migrations/0002_scanner_checkin_policy.sql` — UPDATE policy so
     staff can check tickets in through the scanner.
2. **Environment** — copy `.env.example` → `.env.local` and fill in the values.
3. **Wayl** — set the webhook URL in your merchant dashboard to
   `https://<your-domain>/api/payments/wayl/webhook`. The signature secret must
   match `WAYL_WEBHOOK_SECRET`.
4. **Super Admin** — create the first `admin` account, either by running
   `supabase/seed_super_admin.sql` in the SQL editor (edit the password first,
   it refuses to run with the placeholder), or with the CLI (idempotent,
   uses the service role key, skips seeding if any admin already exists):

```bash
npm run seed:admin -- --dry-run   # preview
npm run seed:admin                # creates admin@platform.com, prints a generated password
```

5. Run:

```bash
npm install
npm run dev     # http://localhost:3000
npm run build   # production check
```

On **Vercel**, add the same variables from `.env.example` in Project Settings →
Environment Variables and set `NEXT_PUBLIC_BASE_URL` to the deployment URL.

## How it fits together

### Mock checkout (temporary)

While real payments are being wired up, `PAYMENTS_MODE=mock` (the default)
bypasses Wayl: the checkout form posts to `/api/payments/mock/checkout`, which
marks an order `paid` and issues tickets directly through the atomic
`purchase_ticket` RPC (UUID QR hashes, row-locked stock deduction). The
customer lands straight on `/tickets/success?ref=<order id>` with QR codes and
PDF downloads, and the dashboard reports stay truthful. The Wayl
`create-session` and webhook routes refuse requests in this mode.

**Restore real payments:** set `PAYMENTS_MODE=wayl` — no code changes needed.

### Purchase → instant issuance
1. Customer picks an event → tier + quantity + name/phone (`/events/[id]`).
2. `POST /api/payments/wayl/create-session` validates availability, stores a
   `pending` order (its UUID doubles as the Wayl `referenceId`), and returns the
   hosted checkout URL.
3. Wayl redirects back to `/tickets/success?ref=<order id>`, which polls
   `GET /api/orders/[reference]`.
4. Wayl calls the webhook → HMAC-SHA256 signature is verified → the
   `issue_tickets_for_order` Postgres function atomically increments
   `sold_quantity` and inserts one ticket per unit with a random
   `qr_code_hash`. **Idempotent:** retried webhooks never double-issue.
5. The success page renders each ticket's QR code plus PDF downloads.

### Check-in (`/dashboard/scanner`)
- Camera decodes with `html5-qrcode`; the hash is checked in through the
  `check_in_ticket` RPC (atomic flip of `is_used`/`used_at`, scoped by RLS to
  events the signed-in account manages).
- Green full-screen overlay + chime for valid; red overlay showing the exact
  `used_at` for already-used; red for unknown codes. Manual fallback search by
  phone number or ticket ID included.

### Reporting (`/dashboard`)
- KPI cards (revenue, sold vs. capacity, checked-in vs. sold) poll every 5s.
- Per-event pages add tier-level sales bars, guest list, and CSV export
  (guest, phone, tier, status, check-in time, order total).

## Notes

- Customer "My Tickets" (`/tickets`) is phone-number based — no customer
  accounts needed; organizers sign in at `/login` (Supabase email/password).
- Ticket PDFs use English labels (default PDF fonts lack Arabic glyphs); the
  QR code itself is locale-independent. The web UI is fully bilingual
  (English / العربية, RTL) via the header toggle.
- Demo event + tiers are seeded by `0001_init.sql`; delete them in production.
