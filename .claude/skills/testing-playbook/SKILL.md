---
name: testing-playbook
description: How to test this POS - unit, integration, e2e (offline and two-device), performance and security tests, commands, budgets, and which tests a change needs. Use when writing or running tests.
---

# Testing playbook

Performance and UX targets come from `docs/PRD.md` §8; style rules for tests from `docs/CODE_STYLE.md` §10.

## 1. Which tests a change needs
| Change | Required tests |
| --- | --- |
| `src/domain` rule | unit (write first), invariant checks |
| Dexie command / sync | integration (fake-indexeddb) + affected e2e journey |
| Supabase migration / RPC | pgTAP (RLS + idempotency) + integration against `supabase start` |
| Cashier screen | e2e journey + screenshot at the 9 viewports + keyboard-only path |
| Print template | snapshot + print-PDF check (Chromium) |
| Migration script | integration on `tests/fixtures/ospos-sample-export.json` (small synthetic export in the real format) |

## 2. Commands (keep output short)
- `npm run test:related -- <files>` while working; `npm test -- --reporter=dot` before commit.
- `npm run test:int` (needs `supabase start`), `supabase test db`.
- `npm run e2e:smoke` = Chromium + Firefox, viewports 390×844 and 1366×768, `--reporter=line`.
- `npm run e2e` = Chromium, Firefox, WebKit × 9 viewports (nightly).
- Show failures only; never paste full passing output into the conversation.

## 3. Unit (Vitest)
- Location: next to code, `*.test.ts`. Coverage gate: `src/domain` ≥ 90% lines/branches, project ≥ 70%.
- Use table-driven tests for money: rounding half-up, discount allocation sums exactly, fractions (0.250 kg × price),
  returns beyond sold rejected, change breakdown, `speakAmount` clip lists.
- Property tests (fast-check) for: allocation sum, ledger recompute == cached balance.

## 4. Integration
- Dexie with `fake-indexeddb/auto`. Fresh DB per test (`new Dexie(uniqueName)`).
- Atomicity: inject a throw after the 2nd write → assert all tables empty.
- Supabase local: seed two companies, two devices (cashier, manager). Call RPCs with each device JWT.

## 5. E2E (Playwright, tests/e2e)
Journeys: cash sale · credit sale then customer receipt · return with invoice · purchase + supplier payment ·
shift open/blind close · stock adjustment · login by photo + PIN.
Offline pattern:
```ts
await context.setOffline(true);
// sell 20 invoices, print, close shift
await context.setOffline(false);
await expect(page.getByTestId('sync-pending')).toHaveText('0', { timeout: 60_000 });
```
Two devices: two `browser.newContext()` (separate IndexedDB), both offline, both sell the same product,
both go online, assert identical stock and customer balances on both and in Supabase.
Selectors: `getByRole` with Arabic accessible names or `data-testid`; never CSS classes.
Visual: `expect(page).toHaveScreenshot()` per viewport for cashier, payment, receipt preview.

## 5b. Agent suite (tester-army/e2e, tests/agent)
- Nine PRD flows in `tests/agent/*.e2e.ts`. Login, PINs and every check are plain locators / SQL; only the business steps use `agent.act`.
- Recording uses the owner's own Anthropic key on his Mac: `export ANTHROPIC_API_KEY=...`, `supabase start`, `npm run test:agent:record`. The recorded steps live in `.e2e/cache/` and are committed.
- CI (`nightly.yml` job `agent-replay`) and local runs replay with `npm run test:agent` (`--strict-cache`): no key, no model. A missing recording fails with `MODEL_UNAVAILABLE`.
- When a UI change breaks replay (`REPLAY_STALE`), re-record on the Mac with the owner's key and commit the cache. Never put the key in CI or in the repo.
- The 55+ Playwright tests in `tests/e2e` stay; the agent suite does not replace them.

## 6. Performance (tests/perf, nightly; bundle check every push)
| Check | Tool | Budget |
| --- | --- | --- |
| Search in 20,000 products | Playwright + CDP `Emulation.setCPUThrottlingRate` 4× (Chromium) | p95 ≤ 300 ms |
| Save sale → print starts | same | ≤ 1 s |
| Cold start offline | same | ≤ 5 s |
| Cashier route JS | `size-limit` | ≤ 300 KB gzip |
| Lighthouse mobile | `@lhci/cli` on preview build (`.lighthouserc.json`) | performance ≥ 70, a11y ≥ 95. 70, not 85, because Lighthouse always measures a first visit, which creates the local database once (~0.3 s on a slow phone); the warm start is covered by the cold-start test above (owner decision, phase 9) |
| Ingest burst | k6 → local Supabase: the 3 seeded devices × 500 invoices (`tests/perf/ingest.k6.js`) | no errors, p95 RPC ≤ 1 s |
| First sync of 20,000 products | `tests/int/pull-perf.test.ts` | < 60 s in fake-indexeddb (was a memory blow-up before the batched search-index patch) |
Run the browser checks with `npm run perf` (Chromium project `perf`, seeds 20,000 fake products into the local database and removes them afterwards). Never real shop data.

## 7. Security
| Check | Tool | When | Gate |
| --- | --- | --- | --- |
| Static analysis | `semgrep --config p/typescript --config p/react --config p/secrets` | every push | no high |
| Secrets in git | `gitleaks detect` | every push | none |
| Vulnerable deps | `osv-scanner` + Dependabot | every push / weekly | no critical/high |
| RLS and RPC auth | pgTAP (see supabase-backend §6) | every push | all pass |
| Running app | OWASP ZAP baseline on staging URL | nightly | no high |
| Headers | assert CSP, X-Content-Type-Options, Referrer-Policy from `public/_headers` | e2e smoke | present |
Plus a test that greps the built `dist/` for `service_role` and Supabase secret patterns → must find nothing.

## 8. Manual checks (cannot be automated)
- Windows 7 + Firefox ESR 115 PC: open app offline, sell, print, close shift — after every release.
- Real worker trial for cashier screen changes (see pos-ui-low-literacy §8).
