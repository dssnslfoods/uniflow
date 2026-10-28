# Uniflow

MRP สำหรับบริหารงานผลิตโรงพิมพ์ (SaaS multi-tenant) — ดูขอบเขตและการออกแบบใน [docs/](docs/)

- [docs/01-srs-analysis.md](docs/01-srs-analysis.md) — วิเคราะห์ SRS + Decision Log
- [docs/02-system-design.md](docs/02-system-design.md) — สถาปัตยกรรม, Data model, กลไกหลัก, UX

## Stack

| Layer | |
|---|---|
| Web | Vite + React 19 + TypeScript, TanStack Router/Query, Tailwind v4, i18next (th/en) — `apps/web` |
| Backend | Supabase: Postgres + RLS, RPC (`api` schema), Auth + custom access token hook — `supabase/` |
| Hosting | Firebase Hosting (SPA) — `firebase.json` |

Schemas: `app` = tables (read through RLS) · `api` = commands (security definer) · `audit` = append-only log.

## Setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
pnpm dev                                         # http://localhost:5173
```

Never put the `service_role` key in the web app or this repo — it bypasses RLS.

### Database

With Docker (preferred):

```bash
supabase start && supabase db reset    # applies supabase/migrations
supabase test db                       # pgTAP tests in supabase/tests/database
```

Without Docker — runs migrations + the same tests on a throwaway local PostgreSQL 17
(uses a small Supabase/pgTAP stand-in in `supabase/tests/local/`):

```bash
pnpm db:test:local
```

### Hosted Supabase project

1. `supabase link --project-ref <ref>` then `supabase db push`
2. Dashboard → Authentication → Hooks → **Custom Access Token** → `public.custom_access_token_hook`
   (locally this is enabled in `supabase/config.toml`)
3. Dashboard → API → Exposed schemas: add `app`, `api`
4. Authentication → URL configuration: add the Firebase Hosting domain to redirect URLs

### Deploy (Firebase Hosting)

Live: **https://uniflow-mrp.web.app** (Firebase project `uniflow-mrp`, see `.firebaserc`).

```bash
pnpm deploy:hosting            # builds apps/web (with apps/web/.env.local) and deploys
```

Supabase Auth must list the hosting domain: `site_url` / `additional_redirect_urls` in
`supabase/config.toml`, applied with `supabase config push` (answer each service prompt
explicitly — an unanswered prompt defaults to **Y**).

Edge Functions: `supabase functions deploy invite-member --use-api`.

## Conventions

- Every table has `tenant_id` (defaults from the JWT) + `unique (tenant_id, id)`; children use composite FKs so rows can never reference another tenant.
- New tables: `select app.apply_tenant_policies('app.<table>', '{roles that write}')` and `select app.add_standard_triggers(...)`. The isolation test (`002_tenant_isolation`) automatically checks every table in `app`.
- Business errors: `perform app.fail('<i18n.key>')` → client shows `errors.<i18n.key>`.
- Master data with history is soft-deleted (`deleted_at`), never hard-deleted.
