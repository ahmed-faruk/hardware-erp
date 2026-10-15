# Architecture

## 1. System overview

Each device sells from its own local database. The cloud collects and redistributes data; it is never required to sell,
print, receive goods or count stock.

```
 Counter PC (Win7 + Firefox ESR)   Manager phone / PC        Storekeeper PC/phone
 ┌──────────────────────────┐      ┌───────────────┐         ┌───────────────┐
 │ React PWA (offline)      │      │ same PWA      │         │ same PWA      │
 │  UI → commands → Dexie   │      │               │         │               │
 │        ↓ outbox          │      │               │         │               │
 └────────┬─────────────────┘      └──────┬────────┘         └──────┬────────┘
          │ HTTPS when online (push ingest_batch / pull pull_changes)
          ▼                                ▼                         ▼
     ┌──────────────────────────────────────────────────────────────────┐
     │ Supabase: Auth (devices) · Postgres + RLS + RPC · Storage (photos)│
     └──────────────────────────────────────────────────────────────────┘
          ▲ static files (app shell)                     ▲ nightly pg_dump
     Cloudflare Pages                               GitHub Actions (artifact)
          ▲ deploy on merge to main
     GitHub repo ← Claude Code (VS Code on the Mac / Claude Code on the web)
```

Thermal printer and cash drawer are driven by the OS printer driver through the browser's print; the barcode scanner
is a USB keyboard.

## 2. Tech stack

| Concern                                                                              | Choice                                                                                                  | Why                                                    |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| UI                                                                                   | React 19 + TypeScript strict + Vite                                                                     | big ecosystem, RTL-friendly, one decision              |
| Offline                                                                              | vite-plugin-pwa (Workbox): precache app shell, cache-first product images                               | works with router unplugged                            |
| Local DB                                                                             | Dexie 4 (IndexedDB) + `dexie-react-hooks` (`useLiveQuery`)                                              | fast queries, transactions, reactive UI                |
| Validation                                                                           | zod                                                                                                     | same schemas in commands and tests                     |
| Cloud                                                                                | Supabase (Postgres, Auth, Storage, RPC)                                                                 | free tier, SQL, RLS                                    |
| Hosting                                                                              | Cloudflare Pages                                                                                        | free, commercial use allowed                           |
| CI/CD                                                                                | GitHub Actions                                                                                          | 2,000 free minutes/month on private repos              |
| Tests                                                                                | Vitest, fake-indexeddb, Playwright, pgTAP, Lighthouse CI, k6, Semgrep, gitleaks, osv-scanner, OWASP ZAP | skill `testing-playbook`                               |
| Styling                                                                              | CSS Modules + CSS custom properties (`src/ui/tokens.css`)                                               | no runtime cost, logical properties, container queries |
| Icons                                                                                | lucide-react                                                                                            | tree-shaken SVG icons                                  |
| Build targets: `firefox115`, `chrome109`, `safari16.4`. No polyfill-heavy libraries. |

## 3. Project structure

```
/                     CLAUDE.md, AGENTS.md, package.json, vite.config.ts, .env.example
/.claude/skills/      8 project skills (loaded on demand by Claude Code)
/docs/                PRD, DESIGN_SYSTEM, ARCHITECTURE, SECURITY, CODE_STYLE, DATABASE, API, costs.md
/docs/reference/      full Arabic spec (prd-v2.ar.md) and MVP plan (mvp-plan.ar.md) — grep only
/src/domain/          pure business rules (money, totals, returns, costing, permissions, schemas) — no I/O
/src/db/              Dexie schema, types, commands (one transaction each), balance rebuilders
/src/sync/            supabase client, push, pull, connectivity, clock check, backup/restore
/src/ui/              app shell, routes, screens, components, tokens.css, strings.ar.ts, print templates
/src/ui/print/        Receipt58, Receipt80, A4Document
/public/              icons, fonts, sounds, _headers, manifest
/supabase/migrations/ SQL migrations (tables, triggers, RLS, RPC)
/supabase/tests/      pgTAP tests
/supabase/seed.sql    dev seed (no real data)
/tools/ospos-export/  browser export script for OpenSourcePOS (read-only)
/tools/ospos-import/  Mac-only import into Supabase (+ validation report)
/tests/e2e/ /tests/perf/ /tests/fixtures/
/.github/workflows/   ci.yml, deploy.yml, nightly.yml
/migration-data/      REAL shop data — git-ignored, Mac only
```

Dependency direction: `ui → db/commands → domain`; `sync → db`; `domain` imports nothing from the app.

## 4. Data flow

### Selling (offline or online)

1. Cashier scans/taps → UI updates the cart in memory and in `heldCarts` (survives reload).
2. Pay → `postSale(input)` → `domain` validates and computes totals, payments, ledger rows, cost.
3. One Dexie transaction writes invoice, lines, payments, stock/party/cash ledger rows, audit row, outbox rows, next number.
4. UI prints the receipt from the saved invoice; drawer opens through the printer driver.
5. `useLiveQuery` refreshes balances and lists from Dexie.

### Sync (when online)

1. Push: outbox rows in `deviceSeq` order, ≤ 200 per `ingest_batch`; server validates, upserts idempotently,
   returns `accepted_up_to` and rejected rows.
2. Pull: `pull_changes(after_seq)` until `has_more = false`; apply upserts/tombstones; rebuild affected balance caches.
3. Heartbeat `ping()` every 30 s decides online state and clock skew.
   Conflict rules: `.claude/skills/offline-sync-engine` §5.

### Device and worker login

Manager registers the device once (online) → device signs in to Supabase Auth → pulls master data → workers log in
locally by photo + PIN, offline included.

### Migration (one-time, then once more at cutover)

OSPOS (logged-in browser) → `tools/ospos-export/export.js` → `migration-data/ospos-export-*.json` on the Mac →
`tools/ospos-import` (transform, opening balances sheet, images, `import_batch`) → validation report → go-live.

## 5. Database and storage

Model and rules: `docs/DATABASE.md`. Product images in Supabase Storage, cached by the service worker.
Device-local settings (printer, paper, sounds) never leave the device.

## 6. External services

Supabase, Cloudflare Pages, GitHub Actions; details and failure behavior in `docs/API.md` §8.

## 7. Deployment

| Step                                                                                                        | Trigger         | Result                                                                               |
| ----------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------ |
| CI                                                                                                          | push / PR       | lint, types, unit, pgTAP, integration, build, bundle size, e2e smoke, security scans |
| Preview                                                                                                     | PR green        | staging DB migrated, `https://<branch>.<project>.pages.dev`                          |
| Production                                                                                                  | merge to `main` | production DB migrated first, then frontend deployed                                 |
| Nightly                                                                                                     | 00:00 UTC       | full e2e matrix, perf + Lighthouse, ZAP, encrypted DB backup                         |
| Rollback: Cloudflare "rollback to previous deployment"; DB forward-fix only. Details: skill `ci-cd-deploy`. |

## 8. Observability

- Device: `SyncStatus` always visible; manager "devices" screen (last sync, pending, rejected, app version, clock skew).
- Errors: caught in an error boundary + `window.onerror` → local store → uploaded to `client_errors`.
- Server: Supabase logs (1 day on free tier) — so anything important is also written to `audit_log`/`client_errors`.

## 9. Scalability notes

- Volume today: ~55 sales/day, 1,406 products, 1 branch, ≤ 5 devices. Free tiers are enough; DB estimated 150–250 MB.
- When the DB passes 70% of 500 MB: archive legacy history to a compressed file, or move to the paid plan.
- More branches: `branches`/`warehouses` already exist; add transfers (deferred feature) and per-branch RLS.
- Heavy reports run in a Web Worker on devices and as RPCs for history; never block the cashier thread.

## 10. Key decisions (ADR summary)

| #   | Decision                                 | Rejected alternative      | Reason                                                  |
| --- | ---------------------------------------- | ------------------------- | ------------------------------------------------------- |
| 1   | Ledgers + derived balances               | editable balance fields   | two offline devices would overwrite each other          |
| 2   | Immutable documents, reversing documents | edit/delete invoices      | audit, sync, tax compliance                             |
| 3   | Integer piasters / milli-units           | JS floats                 | rounding errors in cash and tax                         |
| 4   | Device accounts + worker PIN             | Supabase login per worker | workers cannot type emails; works offline               |
| 5   | No local server in the shop              | LAN server                | cost and maintenance; revisit with multiple branches    |
| 6   | Browser print via OS driver              | raw ESC/POS               | browsers cannot send raw bytes; driver opens the drawer |
| 7   | Browser-based OSPOS export               | SQL dump                  | backup button returns 500 and no phpMyAdmin access      |
