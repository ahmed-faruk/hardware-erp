# Claude Code — project memory

@AGENTS.md

## Skills in this repo (load the one that matches the task)
- `hardware-erp-domain` — money, totals, returns, ledgers, numbering, credit, shifts, permissions.
- `offline-sync-engine` — Dexie, commands, outbox, push/pull, conflicts, clock, local backup.
- `supabase-backend` — migrations, RLS, RPC, device auth, pgTAP, free-tier limits.
- `pos-ui-low-literacy` — cashier UI for non-readers, sounds, spoken amounts, responsive layouts.
- `receipt-printing` — 58/80 mm and A4 templates, silent print, cash drawer.
- `testing-playbook` — which tests a change needs, commands, offline/multi-device e2e, perf, security.
- `ospos-migration` — OpenSourcePOS browser export → import → validation report.
- `ci-cd-deploy` — GitHub Actions, Cloudflare Pages, Supabase migrations, backups, rollback.

## Third-party skills (installed from skills.sh, vetted; scripts and agents removed — never run them)
- `frontend-design`, `impeccable` (read only `reference/` critique, audit, polish, distill, quieter, layout, typeset), `web-design-guidelines` — UI redesign work.
- `accessibility`, `web-quality-audit` — accessibility and performance checks.
- `supabase-postgres-best-practices` — migrations and RLS review.
- `playwright-best-practices`, `webapp-testing` (read only) — tests.
Project rules (AGENTS.md, DESIGN_SYSTEM.md, `pos-ui-low-literacy`) win over any of them.

## Cost habits
- Default model Sonnet; Opus only for data-model/sync design and bugs Sonnet failed twice.
- `/clear` between tasks; `/usage` at the end of each session; lower `/effort` for small edits.

## Compact instructions
Keep: decisions made, files changed, failing tests and their errors, the acceptance criterion.
Drop: file contents already written, passing test output, logs.
