# Agent Instructions

## Project context
Hanafy POS: an offline-first point of sale, stock, credit and cash system for "مركز حنفي للتلوين", a paint and
hardware shop in Egypt. It replaces OpenSourcePOS 3.3.3. Cashiers may not be able to read. Shop PCs run Windows 7 +
Firefox ESR 115. Stack: React 19 + TypeScript + Vite PWA, Dexie (IndexedDB), Supabase (Postgres/Auth/Storage/RPC),
Cloudflare Pages, GitHub Actions. Build only the MVP scope in `docs/PRD.md` §6; ask before anything in §10.

## Before you start — read only what the task needs
| Task touches | Read first |
| --- | --- |
| What to build, scope, user flows | `docs/PRD.md` (the relevant section) |
| Screens, components, colors, layout | `docs/DESIGN_SYSTEM.md` + skill `pos-ui-low-literacy` |
| Folders, data flow, deployment | `docs/ARCHITECTURE.md` |
| Tables, fields, migrations | `docs/DATABASE.md` + skill `supabase-backend` |
| RPCs, commands, error codes | `docs/API.md` |
| Auth, secrets, personal data | `docs/SECURITY.md` |
| Any code | `docs/CODE_STYLE.md` §2–§6 |
| Calculations | skill `hardware-erp-domain` |
| Detail beyond these | grep `docs/reference/prd-v2.ar.md` by requirement ID — never read it whole |
Inspect existing components and helpers before creating new ones.

## General rules
- TypeScript strict. Reuse existing components. Keep modules small. Follow the folder structure in ARCHITECTURE §3.
- `src/domain` is pure (no I/O); all writes go through `src/db/commands` (one Dexie transaction each).
- Money = integer piasters, quantity = integer milli-units. Never floats for business values.
- Posted documents are immutable; corrections are reversing documents. Balances are derived from ledgers.
- No network call on any sell / print / receive / count path.
- Every synced row: `id` (UUID v7), `deviceId`, `createdBy`, `createdAt`, `updatedAt`, `version`.
- Human document numbers: `<devicePrefix>-<TYPE>-<seq6>`, per device, no gaps.
- Ask before major architectural changes.

## Design rules
- Cashier screens: photo-first, icon + color + fixed position, sounds, PIN instead of text confirmation,
  undo instead of "are you sure", touch targets ≥ 56 px, works by keyboard, touch and scanner.
- Tokens only (`src/ui/tokens.css`); strings only from `src/ui/strings.ar.ts`; RTL logical CSS properties.
- Check every UI change at 320, 390, 1024 and 1366 px widths.

## Security rules (full list: `docs/SECURITY.md`)
- Never expose keys; the `service_role` key never enters `src/`, tests or CI build env.
- Secrets only in env files that are git-ignored; `.env.example` holds names only.
- Validate input in commands (zod) and again in RPCs. Verify role and device on the server.
- Never disable RLS, auth, PIN checks or validation to make something pass.
- Never read `migration-data/` in a cloud session; never put real customer data in tests, fixtures, logs or chat.

## Commands
```
npm install            npm run dev            npm run build
npm run lint           npm run typecheck      npm test
npm run test:related -- <files>               npm run test:int
npm run e2e:smoke      npm run e2e            npm run perf
supabase start         supabase db reset      supabase test db
```

## Boundaries — ask the owner before
- Any decision not written in `docs/` or the skills: stop and ask (2–3 options, recommendation marked). Never decide silently.
- Adding a feature listed as deferred, or a new dependency (give one line why).
- Changing the permission matrix, RLS policies, money rounding, document immutability, sync conflict rules.
- Editing an applied migration (never), deleting or weakening tests, changing CI gates.
- Anything that touches production data or the live OpenSourcePOS.

## Working agreement — be efficient with Claude Code usage
- One task per session; stop when the acceptance criterion passes; end with a summary of ≤ 5 lines.
- Plan mode for multi-file work. One clarifying question instead of guessing.
- Read only what the task needs; prefer grep and targeted reads.
- Domain rules: failing test first, then code. Run related tests while working; full suite once before commit; show failures only.
- No subagents or agent teams. Never run an AI agent inside CI.
- Small commits (Conventional Commits), one branch + PR per task. Log the session cost in `docs/costs.md`.

## Definition of done
Lint + typecheck clean · related tests green · offline path checked when data is touched · UI checked at 4 widths ·
docs updated when behavior/schema/API changed · no debug code left.
