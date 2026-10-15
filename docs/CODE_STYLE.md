# Code Style

New code follows these conventions and the patterns already in the repo. Readable beats clever.

## 1. Stack and tooling

TypeScript (strict, `noUncheckedIndexedAccess`), React 19 function components, Vite, CSS Modules + `src/ui/tokens.css`,
Dexie, zod, Vitest, Playwright. ESLint (typescript-eslint, react-hooks, jsx-a11y, import/order) + Prettier
(`printWidth 110`, single quotes, trailing commas). `npm run lint` and `npm run typecheck` must pass with zero warnings.

## 2. General principles

- Keep functions small and single-purpose; components under ~150 lines — split when bigger.
- Reuse before creating: check `src/ui/components` and `src/domain` first.
- No speculative abstractions; three similar blocks before extracting a helper.
- Business logic lives in `src/domain` (pure) — never inside components or SQL only.
- Side effects only in `src/db/commands`, `src/sync`, and UI event handlers.

## 3. Naming

| Thing                 | Style                                      | Example                                |
| --------------------- | ------------------------------------------ | -------------------------------------- |
| Components, types     | PascalCase                                 | `CartLine.tsx`, `SalesInvoice`         |
| Functions, variables  | camelCase                                  | `postSale`, `currentShift`             |
| Constants             | UPPER_SNAKE_CASE                           | `MAX_BATCH_ROWS`                       |
| Booleans              | is/has/can                                 | `isOffline`, `canVoid`                 |
| Files (non-component) | kebab-case                                 | `money.ts`, `break-change.ts`          |
| SQL                   | snake_case; tables plural; RPC verb_object | `sales_invoices`, `ingest_batch`       |
| Tests                 | `<unit>.test.ts`, e2e `<journey>.spec.ts`  | `returns.test.ts`, `cash-sale.spec.ts` |
| Money/qty variables   | suffix unit when ambiguous                 | `totalPiasters`, `qtyMilli`            |

## 4. Types for money and quantity

```ts
export type Piasters = number & { readonly __brand: 'Piasters' };
export type Milli = number & { readonly __brand: 'Milli' };
```

- Create them only through `toPiasters()`, `toMilli()`, arithmetic helpers in `src/domain/money.ts`.
- ESLint `no-restricted-syntax` forbids `parseFloat`, `toFixed`, and `/` on money outside `src/domain/money.ts`.
- Display only through `formatMoney()` / `formatQty()` (they apply the digit-style setting).

## 5. Components

- Functional components, named exports, props typed with an interface `XProps`.
- Data from Dexie via `useLiveQuery`; writes via commands; no fetch inside components.
- Every data view handles loading (skeleton), empty (`EmptyState`), and error (`BigAlert`) states.
- No hard-coded text: strings from `src/ui/strings.ar.ts`; every icon button has `aria-label`.
- Styling: CSS Modules + tokens; logical properties only; no inline colors; no `px` font sizes outside tokens.
- Cashier components must meet `docs/DESIGN_SYSTEM.md` (targets ≥ 56 px, icon + color + label).

## 6. Errors

- Business failures return `Result` objects: `{ ok: true, ... } | { ok: false, code, message }`. Never throw for them.
- Throw only for programming errors; the error boundary logs them to `client_errors`.
- RPC errors are mapped once in `src/sync` to the codes in `docs/API.md` §3.

## 7. Imports and structure

- Order: node/builtin, external, `@/domain`, `@/db`, `@/sync`, `@/ui`, relative — blank line between groups.
- Path alias `@/` = `src/`. No deep relative paths (`../../../`).
- `src/domain` must not import from `db`, `sync`, `ui`, React, Dexie or Supabase (lint rule).
- Remove unused imports/variables; no default exports except Vite/React entry points.

## 8. Comments and docs

- Comment WHY, not WHAT. Cite the requirement id when a rule comes from the spec: `// RET-01: never above sold qty`.
- Public domain functions get a one-line JSDoc with units: `/** Allocates the invoice discount (piasters) over lines. */`
- Update `docs/*.md` in the same PR when behavior, schema or API changes.

## 9. SQL

- One migration per change, named `YYYYMMDDHHMMSS_verb_object.sql`; uppercase keywords; explicit column lists.
- Every table: common columns, trigger, RLS enabled + policies in the same file.
- RPCs: `security definer`, `set search_path = public`, first line `perform assert_device_active();`, return the envelope.

## 10. Tests

- Domain: table-driven tests, written before the code. Names describe behavior: `it('rejects returning more than sold')`.
- No real shop data in tests. Use `tests/fixtures`.
- E2E selectors: roles with Arabic names or `data-testid`; never CSS classes.

## 11. Git

- Branch per task: `feat/pos-quick-grid`, `fix/return-rounding`, `chore/ci-cache`.
- Conventional Commits: `feat(pos): hold multiple carts (POS-05)`. Small commits.
- PR description: what, why, requirement ids, tests run, screenshots for UI at 390×844 and 1366×768.

## 12. Before finishing a task

- [ ] `npm run lint` and `npm run typecheck` clean
- [ ] Related tests pass; full unit suite passes once
- [ ] UI changes checked at 320, 390, 1024, 1366 widths and with keyboard only
- [ ] Offline behavior checked when the change touches data
- [ ] No debug logs, dead code, or TODO without an issue link
- [ ] Docs updated if behavior/schema/API changed
- [ ] Session cost noted in `docs/costs.md`
