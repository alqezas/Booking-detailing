# Progress

Status as of 2026-11-26. "Done" means: works end to end against the real database,
validated on the server, permission-checked, and (where listed) covered by tests.

## Verification (this state)

- `pnpm typecheck` ✅ · `pnpm lint` ✅ (0 errors, 2 warnings: React Hook Form `watch` + React Compiler)
- `pnpm test` + `pnpm test:db` ✅ 35/35 — tenant isolation, IDOR, anon access, role limits,
  concurrent double booking, reschedule clash, cancel frees slot, idempotency, quote by vehicle
  parameters, public booking + manage link, partial payment + refund limits, stock never negative,
  stock consumption on completion, VAT rounding, tire hotel capacity + unpaid release, notification
  dedupe, queue claim/backoff/dead letter, composite-FK cross-tenant block.
- `pnpm test:e2e` ✅ 8/8 (desktop + tablet viewport): sign-in, redirect when signed out,
  public booking → confirmation → cancel via link, mechanic blocked from finance.
- `pnpm build` ✅ (31 routes).

## Phase 1 — Foundation ✅

- [x] Multi-tenant schema (12 migrations), composite FKs, RLS forced on every table
- [x] RBAC: roles, 24 permissions, per-member overrides, module switches
- [x] Supabase Auth via `@supabase/ssr`: sign-in, reset password, invites, proxy session refresh, business switcher
- [x] Super Admin: create tenant (+ owner invite), activate/deactivate, modules, license model; no tenant PII
- [x] Audit log triggers, idempotency keys, support-access grants table
- [x] App shell: sidebar by permission/module, command palette (Ctrl K) with live customer search, light/dark, responsive
- [x] i18n: en, cs, pl, uk, sk, de, ru (see limitations)

## Phase 2 — Core CRM ✅

- [x] Customers: search (name/phone/plate), segments, create/edit, consents journal, CSV import/export, GDPR export, anonymise
- [x] Vehicles: list, find by plate, create/edit, book from row
- [x] Services, categories, visual pricing & duration rules, live price check
- [x] Calendar: by post / by employee / week (load %) / list; drag-and-drop move, resize duration, click-to-book,
      walk-in, slot finder, booking sheet with status flow, internal notes, create order; Realtime refresh
- [x] Work orders: create (or from booking), items (service/product/custom), extra-work approval, status flow,
      payments, partial payments, refunds, printable work order, mechanic notes RPC
- [x] Dashboard with real aggregates (today/week/month revenue, load, popular services, low stock, storage ending, seasonal candidates)

## Phase 3 — Tire hotel ✅ (photos pending)

- [x] Branch → warehouse → zone/rack/shelf/cell grid generator, capacity, fill %
- [x] Check-in with per-tire DOT/tread/damage, automatic cell, contract, optional payment
- [x] QR label (code only, no personal data), printable 100×60 mm
- [x] Move, extend, pay, release (blocked when unpaid unless confirmed), movement history
- [ ] Photo upload per tire (bucket `private-files`, `attachments` table and storage policies exist; UI missing)
- [ ] Printable storage contract / acceptance act (data exists; template missing)

## Phase 4 — Public booking ✅

- [x] `/s/[slug]` branded page, independent language, branch → vehicle → services → estimate → slot → contact
- [x] Slots respect hours, closures, lead time, horizon, post compatibility, occupancy
- [x] Rate limiting (fingerprint + phone), honeypot, phone validation, consent capture
- [x] `/booking/[token]` view / reschedule / cancel within business rules
- [x] Transactional notifications queued (confirmation, 24 h, 2 h, reschedule, cancel, order ready, storage ending, waitlist offer)
- [ ] Per-service / per-period online-booking blackout UI (DB: `online_bookable`, `branch_closures`; no date-range blackout table yet)

## Phase 5 — Business automation (partial)

- [x] Inventory: products, receipts/issues/write-offs/returns/adjustments, transfers, history, low stock, average cost
- [x] Employees: create with schedule, skills, commission %, 90-day stats and commission calculation
- [x] Finance: payments by period and method, expenses, debts, CSV export; labelled as non-fiscal
- [x] Analytics: revenue, gross profit (with COGS), avg ticket, new/returning, retention, CLV, cancel/no-show,
      storage revenue, hotel fill, by service/employee/month/weekday, period comparison, branch filter
- [x] Notification worker + test adapter + Resend/Twilio/Telegram/WhatsApp Cloud adapters, retries, dead letter, cron
- [ ] Marketing campaigns UI (table `marketing_campaigns`, consent-aware `enqueue` exist; no builder/scheduler UI)
- [ ] Corporate fleets page (tables, discounts applied to orders, customer link exist; no dedicated page/reports)
- [ ] Waiting list UI (table + automatic offer on cancellation exist; no screen to add/manage entries)
- [ ] Shifts/absences editing UI (tables exist; absences block bookings; only creation of schedule on employee create)
- [ ] Inventory reservations for orders, stock-take (inventory count) screen

## Phase 6 — Advanced (mostly pending)

- [x] PWA: manifest, icons, service worker (static only), offline page
- [ ] Web Push sending (SW handles `push`; subscription storage table exists; VAPID + sender missing)
- [ ] AI assistant (design in docs/INTEGRATIONS.md; not built)
- [ ] Photo/attachment uploads (except logo), PDF generation server-side (browser print → PDF works today)

## Known limitations

- **Translations:** English is complete. ru/uk/cs/pl/de/sk cover navigation, common UI, errors, sign-in,
  dashboard, statuses and the whole public booking flow; deeper staff screens fall back to English.
  Notification templates are seeded in en + cs only.
- Calendar has no UI for `block_time` yet (RPC + rendering of blocks exist) and no month view.
- Seasonal mode is a stored flag; extra hours are configured via `workstation_schedules` (no UI yet).
- `inviteUserByEmail` needs SMTP configured in Supabase for real emails; locally they go to Mailpit (port 56324).
- Staff lookup by email when the invited user already exists scans the first 200 auth users.
- Holidays are per-branch dates (`branch_closures`); no national holiday import.
- Customer duplicate *detection* is not automatic; merging is available via RPC (`merge_customers`) but has no UI.
- The Edge Function was type-reviewed but not executed locally (local stack runs without edge-runtime);
  the queue semantics it relies on are covered by DB tests.
