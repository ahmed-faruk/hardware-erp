# Session costs

| Date       | Task                                                                                                                                              | Model         | Cost         | Notes                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ------------ | -------------------------------------------------------- |
| 2026-10-09 | KICKOFF: machine setup, phase 1 scaffold, deploy to Cloudflare Pages, phase 2 domain library, phase 3 design (Opus, plan mode) and build (Sonnet) | Sonnet / Opus | not recorded | Run `/usage` at the end of the session and fill this in. |

## Incident log

| Date       | Item                                                                                                                                                                                                                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-09 | A Supabase database password was written in chat. The project that password belonged to was deleted and both projects (staging, production) were recreated with generated passwords stored only in GitHub secrets.                                                                                        |
| 2026-10-16 | Plan v5 P6–P8 done: invoice search, reports by supplier, smart-report returns, two-device day test (`full-day-v5`), agent flow 22, one Chrome session on localhost with fixture PIN (GIF `p6-sales-invoices-filter.gif` in Downloads). Full local e2e: only the known Firefox category-report spec fails. |
| 2026-10-17 | Exception to "no destructive commands on staging": the owner asked to wipe the staging database and reload it from a fresh OpenSourcePOS export (workflow staging-reset, staging only; production is never touched).                                                                                      |
| 2026-10-20 | Security audit Phase A + H1 fix (revoke ingest bundles from anon), PR #82 | Sonnet 5.5 low | not recorded | Run `/usage` at the end of the session and fill this in. |
