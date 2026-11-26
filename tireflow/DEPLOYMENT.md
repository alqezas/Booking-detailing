# Deployment

Three environments, each with its **own** Supabase project and Vercel environment:

| Env | Supabase | Vercel | Data |
| --- | --- | --- | --- |
| Local | `supabase start` (Docker) | `pnpm dev` | demo seed |
| Staging | project `tireflow-staging` | Preview deployments | demo seed allowed |
| Production | project `tireflow-prod` | Production | migrations only, **never** the seed |

Preview deployments must point at staging, not production (set the variables per
Vercel environment below).

## 1. Supabase project

1. Create the project (EU region, e.g. Frankfurt) on a paid plan for production.
2. Link and push migrations:
   ```bash
   cd tireflow
   pnpm exec supabase login
   pnpm exec supabase link --project-ref <ref>
   pnpm exec supabase db push          # applies supabase/migrations/*
   ```
   For staging only, you may load demo data: `psql "$STAGING_DB_URL" -f supabase/seed.sql`.
3. Auth → URL configuration: Site URL `https://<your-domain>`, redirect URLs
   `https://<your-domain>/auth/callback`, plus the staging/preview domains for staging.
   Enable email confirmations and configure SMTP (Auth → SMTP) for real invites.
4. Deploy the worker and give the scheduler its secrets:
   ```bash
   pnpm exec supabase functions deploy notifications-worker
   ```
   SQL editor:
   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   select vault.create_secret('<secret key>', 'worker_key');
   ```
   The cron jobs (migration `20261126001200_cron.sql`) start working once both exist.
5. Create the first platform admin (SQL editor, after signing up once):
   ```sql
   insert into public.platform_admins (user_id)
   select id from auth.users where email = 'you@example.com';
   ```

## 2. Vercel project

1. Import the GitHub repo, **Root Directory = `tireflow`**, framework Next.js, Node 22+.
2. Environment variables (Production → prod project, Preview → staging project):

   | Variable | Scope | Notes |
   | --- | --- | --- |
   | `NEXT_PUBLIC_APP_URL` | all | e.g. `https://app.tireflow.cz` |
   | `NEXT_PUBLIC_SUPABASE_URL` | all | `https://<ref>.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all | `sb_publishable_…` |
   | `SUPABASE_SECRET_KEY` | server | `sb_secret_…` — mark Sensitive, never `NEXT_PUBLIC_` |
   | `SUPABASE_PROJECT_REF` | server | used to salt public rate-limit fingerprints |

3. Add the custom domain. Each tenant's booking page is `https://<domain>/s/<slug>`.

## 3. CI

`.github/workflows/tireflow.yml` (repo root) runs on changes under `tireflow/`:
local Supabase → type drift check → typecheck → lint → unit → DB tests → build → Playwright.

## 4. Release checklist

- `pnpm typecheck && pnpm lint && pnpm test && pnpm test:db && pnpm build`
- New migration? `pnpm exec supabase db push` against staging first, then production.
- Regenerate types (`pnpm db:types`) and commit them with the migration.
- Never run `supabase db reset` or the seed against production.

## Costs (checked November 2026 — verify before quoting customers)

- **Vercel Hobby is for personal, non-commercial use only.** Selling TireFlow requires
  **Pro: $20/month per deploying seat**, including $20 usage credit.
- **Supabase Free** pauses inactive projects and has small quotas (500 MB DB, 5 GB egress).
  Production needs **Pro: $25/month per organization**, which includes a $10 compute
  credit (one Micro instance), 8 GB DB disk, 100k MAU, 250 GB egress, daily backups (7 days).
  Overage: $0.00325 per MAU, $0.09 per GB egress.
- Because all tenants share one project, the infrastructure cost per extra tire service
  is close to zero until compute or egress grows; upgrade the compute size first.
- Cost controls built in: one cron for all tenants that only calls the worker when jobs
  are due, server-side pagination, aggregated SQL for dashboards/analytics, realtime
  limited to three tables and filtered by business, static assets cached by the CDN.
