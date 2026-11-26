# TireFlow — tire service management (CRM)

Multi-tenant B2B CRM for tire services in CZ / PL / UA / SK / AT: calendar with posts,
work orders, tire hotel, inventory, online booking, finance and analytics.
One codebase, one Vercel project and one Supabase project per environment; every
business is a tenant isolated by PostgreSQL Row Level Security.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS 4 ·
shadcn/ui (Base UI) · TanStack Query & Table · React Hook Form + Zod · Recharts ·
next-intl (7 languages) · Supabase (Postgres, Auth, Storage, Realtime, Edge Functions, Cron) · Vercel.

> This folder is self-contained (own `package.json`, own Supabase project `tireflow`).
> The repo-root `AGENTS.md` (Astryx) applies to the other apps in the repo; TireFlow
> follows its own stack as specified (Tailwind + shadcn/ui).

## Quick start (local)

Requirements: Node 22+, pnpm 12, Docker Desktop running.

```bash
cd tireflow
pnpm install
pnpm db:start          # local Supabase on ports 563xx (no clash with other apps)
pnpm db:reset          # applies migrations + demo seed
cp .env.example .env.local   # then paste the values printed by: pnpm exec supabase status
pnpm dev               # http://localhost:3000
```

Demo logins (local only, created by `supabase/seed.sql`, password in that file):
`owner@`, `manager@`, `mechanic@`, `accountant@`, `admin@` (platform admin), `other@` (second tenant) — all `@tireflow.test`.

Useful pages: `/app/tireflow-demo/dashboard`, `/s/tireflow-demo` (public booking), `/admin`.

## Scripts

| Command | What it does |
| --- | --- |
| `pnpm dev` / `pnpm build` | Next.js dev server / production build |
| `pnpm typecheck` | route types + `tsc --noEmit` |
| `pnpm lint` | ESLint (Next + React Compiler rules) |
| `pnpm test` | unit tests (money, time zones, error mapping) |
| `pnpm test:db` | integration tests against local Supabase: RLS, RBAC, double booking race, payments, stock, tire hotel, queue |
| `pnpm test:e2e` | Playwright: sign-in, public booking + cancel, role limits (desktop + tablet viewport) |
| `pnpm db:reset` | rebuild local DB from migrations + seed |
| `pnpm db:types` | regenerate `src/lib/supabase/database.types.ts` |

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — tenancy, security model, database, business logic
- [DEPLOYMENT.md](DEPLOYMENT.md) — Supabase + Vercel setup, environments, cron, costs
- [docs/ONBOARDING.md](docs/ONBOARDING.md) — connecting a new tire service
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) — email, SMS, WhatsApp, Telegram, push, AI
- [PROGRESS.md](PROGRESS.md) — what is done, what is left, known limitations
