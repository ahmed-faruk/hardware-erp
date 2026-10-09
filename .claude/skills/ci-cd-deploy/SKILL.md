---
name: ci-cd-deploy
description: GitHub Actions CI/CD for this POS - tests, security scans, Cloudflare Pages preview and production deploys, Supabase migrations, nightly jobs, backups, rollback. Use for .github/ work.
---

# CI/CD and deployment

Ready-to-adapt workflow files: [workflows.md](workflows.md). Copy them, replace `hardware-erp` with the
Cloudflare Pages project name, then run once and fix flags if a tool version changed.

## 1. Flow
1. Branch per task → push → `ci.yml`: lint, typecheck, unit, pgTAP, integration (local Supabase), build,
   bundle size, e2e smoke (Chromium + Firefox), security scans.
2. Pull request green → `preview` job: `supabase db push` to STAGING, `wrangler pages deploy` with
   `--branch=<branch>` → preview URL `https://<branch>.hardware-erp.pages.dev`.
3. Merge to `main` → `deploy.yml`: `supabase db push --dry-run` then `db push` to PRODUCTION, then deploy `dist`
   with `--branch=main` (production URL).
4. `nightly.yml` (00:00 UTC): full e2e matrix, performance + Lighthouse, OWASP ZAP baseline on staging,
   encrypted production backup as a 30-day artifact.
Claude is never invoked inside CI (cost rule).

## 2. Secrets and variables (GitHub → Settings → Secrets and variables → Actions)
Secrets: `CLOUDFLARE_API_TOKEN` (Pages:Edit), `CLOUDFLARE_ACCOUNT_ID`, `SUPABASE_ACCESS_TOKEN`,
`SUPABASE_PROJECT_REF_STAGING`, `SUPABASE_PROJECT_REF_PROD`, `SUPABASE_DB_PASSWORD_STAGING`,
`SUPABASE_DB_PASSWORD_PROD`, `BACKUP_PASSPHRASE`.
Variables (public values): `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_ANON_KEY`, `PROD_SUPABASE_URL`,
`PROD_SUPABASE_ANON_KEY`, `STAGING_URL`.
The `service_role` key is never stored in GitHub.

## 3. Rules
- Migrations must be backward compatible with the app currently in production (expand → deploy → contract).
  Production DB is migrated BEFORE the new frontend is deployed.
- `concurrency` on every workflow; production deploys never cancel in progress.
- Save Actions minutes (2,000/month free on private repos): `paths-ignore: ['docs/**', '**/*.md']`,
  npm + Playwright browser caches, full browser/viewport matrix only at night, `timeout-minutes` on every job.
- Pin actions to a major version (`@v4`); update via Dependabot (`.github/dependabot.yml`, weekly, npm + actions).
- PWA: `sw.js` and `index.html` served with `Cache-Control: no-cache`; hashed assets immutable (see `_headers`).
  New version → app shows "update available"; it never reloads during an open sale.

## 4. Security headers
`public/_headers` (Cloudflare Pages) — template in workflows.md. CSP must list the Supabase project URL in
`connect-src` (https + wss) and `img-src`. E2E smoke asserts the headers exist on the preview URL.

## 5. Rollback
- Frontend: Cloudflare dashboard → Pages project → Deployments → previous production deployment → Rollback.
- Database: forward-only. Write a new migration that undoes the change; never edit an applied migration.
- If a bad migration blocks sync, devices keep selling offline; fix forward, then they resync.

## 6. First-time setup checklist
- [ ] Cloudflare Pages project created with "Direct Upload" (deploys come from Actions, not Cloudflare Git builds).
- [ ] Two Supabase projects (staging, production), region Frankfurt.
- [ ] Secrets/variables above added.
- [ ] Branch protection and environment reviewers on PRIVATE repos need a paid GitHub plan. On GitHub Free,
      `deploy.yml` re-runs unit tests and the build and deploys only if they pass; merge only PRs whose `ci` is green.
