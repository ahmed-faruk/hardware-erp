# ospos-import (Mac only)

Moves the OpenSourcePOS browser export into Supabase. Rules: skill `ospos-migration`. Real data never leaves this Mac and is never
committed (`migration-data/` and `tools/ospos-import/out/` are git-ignored). Outputs and reports hold counts, never customer rows.

Setup: create `tools/ospos-import/.env.local` (git-ignored) with

```
TARGET_SUPABASE_URL=https://<project-ref>.supabase.co
TARGET_SUPABASE_SERVICE_ROLE_KEY=<service_role key from the Supabase dashboard>
```

Local database: values from `supabase status`. Any non-local target needs `--confirm <host>` on every write step.

| Step | Command | What it does |
| --- | --- | --- |
| 1 | `npm run import -- read` | checks the export format and prints counts |
| 2 | `npm run import -- transform` | parse + match + transform → `out/rows/*.jsonl`, prints counts and warnings |
| 3 | `npm run import -- balances` | writes `migration-data/opening-balances.xlsx` for the owner to fill |
| 4 | `npm run import -- load` | `import_batch` in batches of 500, idempotent (safe to re-run) |
| 5 | `npm run import -- apply-balances` | reads the owner's xlsx and loads the opening documents (refuses to run twice) |
| 6 | `npm run import -- validate` | writes `out/validation-report.md`; exit 1 if a blocking check fails |
| – | `npm run import -- images` | skipped: the first export has no product photos |

Order for a new environment: local → staging → production, each `load` then `validate`. Production: `--confirm <host>`.
A re-run never duplicates (ids are UUID v5 of `ospos:<kind>:<id>`), but it also never changes a row that already exists: to
reload corrected data into a database, reset it first (local) or post corrections as documents (production).

Decisions (see `transform.ts`): history rows are `is_legacy` with no ledger rows and stay on the server (never pulled by devices);
receivings with no known supplier link to an archive placeholder supplier; OSPOS cash rounding is stored in `cash_rounding`;
sale lines whose product no longer exists keep their name in `legacy_text`.
