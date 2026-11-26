# Architecture

## Topology

```
Browser / installed PWA
   │  HTML, RSC, server actions            │ Realtime (websocket, RLS-filtered)
   ▼                                        ▼
Vercel — Next.js 16 (Node runtime)      Supabase
   proxy.ts      session refresh,         Postgres 17  ← all business rules (RPC, triggers, RLS)
                 optimistic redirect      Auth         email+password, invites, reset
   Server Components  read via RLS        Storage      public-assets / private-files buckets
   Server Actions     validate (Zod) →    Edge Function notifications-worker (Deno)
                      call RPC            pg_cron      one scheduler for all tenants
   /api/export/*      CSV, permission-checked
```

No other servers (no Redis, no Express, no VPS). Rate limiting, queues and
idempotency live in Postgres tables.

## Multi-tenancy

- One `businesses` row per tire service, addressed by `slug` (`/app/[slug]`, `/s/[slug]`).
- Every tenant table has `business_id` and `UNIQUE (business_id, id)`. Children reference
  parents with **composite foreign keys** `(business_id, parent_id)`, so a row can never
  point at another tenant's row — verified even with the secret key (test `cross-tenant references`).
- **RLS is enabled and forced on every table in `public`.** Policies call
  `has_perm(business_id, perm)` / `is_member(business_id)` (SECURITY DEFINER, `search_path=''`).
- The tenant id used by server code always comes from `requireBusiness(slug)` on the server
  (membership checked), never from the client. Prices are always computed in the database.
- Onboarding a tenant = one RPC (`admin_create_business`) + an Auth invite. No deploy.

## Roles and permissions (RBAC)

`memberships(business_id, user_id, role, granted_permissions[], revoked_permissions[])`.
Role defaults live in `role_permissions` (24 permission codes such as `calendar.manage`,
`finance.view`, `tire_hotel.manage`). Per-member overrides are possible.

| Role | Key rights |
| --- | --- |
| owner | everything in the business |
| manager | calendar, customers, orders, tire hotel, inventory, takes payments |
| mechanic | own assigned orders (`my_work` RPC returns no money), status in_progress/ready, notes |
| accountant | finance read/export, analytics, orders read |
| platform admin | creates/deactivates tenants, modules, licenses — **no RLS access to tenant data**; `admin_list_businesses` returns counts only. Support access is modelled as time-boxed, audited `support_access_grants`. |

Modules (`business_modules`) can be turned off per tenant; disabled modules disappear
from navigation, pages 404, and module-scoped policies hide the data.

## Writes go through RPCs

Tables that carry invariants are read-only for clients (`REVOKE INSERT/UPDATE/DELETE`);
all writes go through SECURITY DEFINER functions that start with `private.require_perm()`:

| Area | Functions | Guarantees |
| --- | --- | --- |
| Booking | `create_booking`, `reschedule_booking`, `set_booking_status`, `block_time`, `find_slots` | duration from services + rules; post compatibility (equipment, vehicle category, allowed posts); employee absence; idempotency key |
| No double booking | trigger `sync_booking_occupancy` → `resource_occupancies` with `EXCLUDE USING gist (resource_kind =, resource_id =, during &&)` | posts and mechanics can never overlap, including concurrent transactions (test `rejects a concurrent double booking`) |
| Quote | `quote_service(s)` | visual pricing and duration rules (`set` / `add` / `percent`) by vehicle category, rim range, RunFlat, TPMS, rim type, wheel count |
| Work orders | `create_work_order`, `add_work_order_item`, `decide_additional_work`, `set_work_order_status` | price snapshot per line; extra work needs approval; completion consumes stock in the same transaction; status history |
| Money | `record_payment`, `refund_payment`, `record_storage_payment` | integer minor units, half-away-from-zero per line, VAT included or added; refunds ≤ remaining; payments append-only; idempotency keys |
| Inventory | `record_inventory_movement`, `transfer_stock` | append-only journal, stock maintained by trigger with row lock, never negative, moving average cost; hotel warehouses can't hold stock |
| Tire hotel | `check_in_tire_set`, `move_tire_set`, `release_tire_set`, `extend_storage`, `create_storage_grid` | cell capacity enforced by CHECK + row lock; movement journal; unpaid release blocked unless explicit |
| Public | `public_business`, `public_quote`, `public_slots`, `public_create_booking`, `public_booking`, `public_cancel_booking`, `public_reschedule_booking` | only online-bookable services, opening hours, horizon, rate limits; manage link = 24 random bytes, only SHA-256 stored |
| GDPR | `export_customer`, `anonymize_customer`, `merge_customers` | export as JSON, anonymise personal fields while keeping financial rows, audit entries |

## Time and money

- All instants are `timestamptz`; each business has an IANA time zone. Day boundaries,
  opening hours and slots are computed in that zone (DST-safe, unit tested).
- All amounts are `bigint` minor units in the business currency (CZK, EUR, PLN, UAH).
  Tax rates are basis points (2100 = 21 %).

## Notifications

`private.enqueue()` renders a localized template into `notification_jobs` with a
**dedupe key** (`UNIQUE (business_id, dedupe_key)`), honouring the customer's channel,
language and marketing consent (transactional vs marketing separated). Reminders 24 h / 2 h
are re-queued with the booking start in the key, so a reschedule creates new reminders.

The Edge Function `notifications-worker` is called every minute by pg_cron (only when
jobs are due). It claims batches with `FOR UPDATE SKIP LOCKED`, sends via an adapter
(test, Resend, Twilio, Telegram, WhatsApp Cloud), and reports back; the database applies
exponential backoff and moves exhausted jobs to `dead` (dead letter). Missing secrets
fail loudly — nothing pretends to be delivered.

## Realtime

The calendar subscribes to `postgres_changes` on `bookings` filtered by
`business_id=eq.<id>`; RLS decides what each subscriber receives. Refreshes are debounced.
Only `bookings`, `work_orders` and `inbox_notifications` are in the publication.

## Frontend

- Server Components read data with the user's session (RLS). Mutations are server actions
  that validate with Zod (schemas shared with React Hook Form) and call RPCs.
- `cacheComponents` is intentionally off: every CRM screen is per-user and dynamic, and
  authenticated responses get `Cache-Control: private, no-store`.
- i18n: next-intl without locale in the URL. CRM language = user profile; booking page
  language = business setting (or `?lang=`), independent. English is the fallback for
  any missing key.
- PWA: manifest + `sw.js` that caches only static build assets and an offline page.
  Navigations and all Supabase calls always hit the network, so no personal data is
  cached and nothing requiring server checks can be "confirmed" offline.

## Security checklist

RLS on all tables · server-side permission checks in every action · composite FKs ·
no secret key in the browser (`server-only` admin client used only for Auth invites) ·
rate limits on public RPCs (per fingerprint and per phone) + honeypot · strict
`search_path` on definer functions · private bucket with member-only policies ·
CSV formula-injection escaping · open-redirect safe `next` parameter · security headers ·
audit log triggers on businesses, memberships, settings, customers, services, pricing
rules, bookings, payments, support grants.
