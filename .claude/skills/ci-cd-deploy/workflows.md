# Workflow templates

Replace `hardware-erp` with your Cloudflare Pages project name. Tool CLIs change; on the first run fix any flag
the log rejects and record the fix here.

## .github/workflows/ci.yml
```yaml
name: ci
on:
  pull_request:
    paths-ignore: ['docs/**', '**/*.md']
  push:
    branches-ignore: [main]
    paths-ignore: ['docs/**', '**/*.md']
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
jobs:
  checks:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm run lint && npm run typecheck
      - run: npm test -- --coverage --reporter=dot
      - uses: supabase/setup-cli@v1
        with: { version: latest }
      - run: supabase start
      - run: supabase test db
      - run: npm run test:int
      - run: npm run build
      - run: npx size-limit
      - uses: actions/cache@v4
        with: { path: ~/.cache/ms-playwright, key: pw-${{ hashFiles('package-lock.json') }} }
      - run: npx playwright install --with-deps chromium firefox
      - run: npm run e2e:smoke
      - if: failure()
        uses: actions/upload-artifact@v4
        with: { name: playwright-report, path: playwright-report, retention-days: 7 }

  security:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: semgrep
        run: docker run --rm -v "$PWD:/src" -w /src semgrep/semgrep semgrep scan --config p/typescript --config p/react --config p/secrets --error --severity ERROR
      - name: gitleaks
        run: docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo --no-banner
      - name: osv-scanner
        run: docker run --rm -v "$PWD:/src" ghcr.io/google/osv-scanner:latest scan source -r /src
      - name: no secrets in bundle
        run: npm ci && npm run build && ! grep -rE "service_role|sb_secret_" dist/

  preview:
    if: github.event_name == 'pull_request'
    needs: [checks, security]
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci && npm run build
        env:
          VITE_SUPABASE_URL: ${{ vars.STAGING_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ vars.STAGING_SUPABASE_ANON_KEY }}
      - uses: supabase/setup-cli@v1
      - run: supabase link --project-ref "$REF" && supabase db push
        env:
          REF: ${{ secrets.SUPABASE_PROJECT_REF_STAGING }}
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD_STAGING }}
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy dist --project-name=hardware-erp --branch=${{ github.head_ref }}
```

## .github/workflows/deploy.yml
```yaml
name: deploy
on:
  push:
    branches: [main]
    paths-ignore: ['docs/**', '**/*.md']
concurrency:
  group: deploy-production
  cancel-in-progress: false
jobs:
  deploy:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - run: npm test -- --reporter=dot
      - run: npm run build
        env:
          VITE_SUPABASE_URL: ${{ vars.PROD_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ vars.PROD_SUPABASE_ANON_KEY }}
      # e2e already ran on the PR against local Supabase; never run e2e against production data
      - uses: supabase/setup-cli@v1
      - name: migrate production (before frontend)
        run: |
          supabase link --project-ref "$REF"
          supabase db push --dry-run
          supabase db push
        env:
          REF: ${{ secrets.SUPABASE_PROJECT_REF_PROD }}
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD_PROD }}
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy dist --project-name=hardware-erp --branch=main
```

## .github/workflows/nightly.yml
```yaml
name: nightly
on:
  schedule: [{ cron: '0 0 * * *' }]
  workflow_dispatch:
jobs:
  e2e-full:
    runs-on: ubuntu-latest
    timeout-minutes: 40
    strategy:
      fail-fast: false
      matrix: { browser: [chromium, firefox, webkit] }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci
      - uses: supabase/setup-cli@v1
      - run: supabase start
      - run: npx playwright install --with-deps ${{ matrix.browser }}
      - run: npm run e2e -- --project=${{ matrix.browser }}

  perf:
    runs-on: ubuntu-latest
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: npm }
      - run: npm ci && npm run build
      - uses: supabase/setup-cli@v1
      - run: supabase start
      - run: npx playwright install --with-deps chromium && npm run perf
      - run: npx @lhci/cli autorun
      - uses: grafana/setup-k6-action@v1
      - run: k6 run tests/perf/ingest.k6.js

  zap:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - run: docker run --rm -t ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t "${{ vars.STAGING_URL }}" -I

  backup:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
      - run: |
          supabase link --project-ref "$REF"
          supabase db dump -f schema.sql
          supabase db dump --data-only -f data.sql
          tar czf backup.tgz schema.sql data.sql
          gpg --batch --yes --pinentry-mode loopback --passphrase "$PASS" -c backup.tgz
        env:
          REF: ${{ secrets.SUPABASE_PROJECT_REF_PROD }}
          SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          SUPABASE_DB_PASSWORD: ${{ secrets.SUPABASE_DB_PASSWORD_PROD }}
          PASS: ${{ secrets.BACKUP_PASSPHRASE }}
      - uses: actions/upload-artifact@v4
        with: { name: db-backup-${{ github.run_id }}, path: backup.tgz.gpg, retention-days: 30 }
```
Restore test (monthly, manual): download artifact → `gpg -d` → load into `supabase start` locally → run validation queries.

## public/_headers (Cloudflare Pages)
```
/*
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://<ref>.supabase.co; connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co; font-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(self), microphone=(), geolocation=()
/sw.js
  Cache-Control: no-cache
/index.html
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```
Use one CSP per environment by generating `_headers` at build time from `VITE_SUPABASE_URL`.

## .github/dependabot.yml
```yaml
version: 2
updates:
  - { package-ecosystem: npm, directory: "/", schedule: { interval: weekly }, open-pull-requests-limit: 5 }
  - { package-ecosystem: github-actions, directory: "/", schedule: { interval: weekly } }
```
