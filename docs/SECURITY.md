# Security

Rules every developer and AI agent follows in this project. If a requested change conflicts with this file, stop and ask.

## 1. What we protect

- Money records (sales, drawer cash, credit balances) from mistakes and from staff tampering.
- Customer and supplier personal data (names, phones, addresses) — Egyptian Personal Data Protection Law 151/2020.
- The shop's ability to keep selling (availability) and its history (backups).

## 2. Authentication and authorization

- **Devices (owner decision 2026-10-17):** there is no activation code. A new browser opens the app and logs in with a worker's
  username and password; the server (`login_device`) checks the password and registers the browser as a manager device.
  A lost device is revoked (`revoke_device`) and wipes its local data on next start.
- **Workers:** username + password (≥ 6 characters). The server keeps a bcrypt hash in `worker_credentials`, which no device can read
  and which is never pulled. 5 wrong tries lock the username for 15 minutes. The first account is `admin` / `admin` and must set
  a new password at its first login. A worker who logged in on a device before can log in offline: the device keeps a salted PBKDF2 verifier of the password in its own settings (never synced).
  Screen locks after idle time (setting).
- **Permission groups:** every screen, report tab and button is an action in `src/domain/permissions.ts`. A manager builds groups (yes / no per action) and gives one to a worker. The server enforces them with `worker_can(worker, action)` (migration `20261012100000_permission_groups.sql`) in `ingest_row` and in every bundle that used a hard-coded manager check; approvals (`approved_by`) need an approver whose own access to that action is `yes`. A manager always keeps `view.workers`, `manageUsers`, `manageGroups`, `view.settings`, `settings`. Limit: report RPCs are still "manager device only" on the server, so report tabs are gated per worker in the UI only.
- **Authorization:** one permission matrix in `src/domain/permissions.ts` (roles: cashier, storekeeper, manager) used by
  the UI AND re-checked by `ingest_batch` on the server. Never trust a role or worker id sent by the client without
  checking it against the `workers` table and the device's `max_role`.
- **No approvals (owner decision 2026-10-17):** an action is allowed or refused by permission; there are no manager PIN steps.
- **RLS:** enabled on every table in the migration that creates it. Clients get SELECT scoped to their company; no direct
  INSERT/UPDATE/DELETE. Writes only through `security definer` RPCs with `set search_path = public`.
- Cost and profit columns are exposed to non-manager devices only through views without them.

## 3. Secrets and environment variables

| Name                                                                        | Where                                           | Secret?                              |
| --------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------ |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`                               | `.env.local`, GitHub variables                  | public by design (RLS protects data) |
| `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD_*`, `SUPABASE_PROJECT_REF_*` | GitHub secrets                                  | yes                                  |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`                             | GitHub secrets                                  | yes                                  |
| `BACKUP_PASSPHRASE`                                                         | GitHub secrets + owner's password manager       | yes                                  |
| `TARGET_SUPABASE_SERVICE_ROLE_KEY`                                          | `tools/ospos-import/.env.local` on the Mac only | yes — highest                        |

- `.env.example` lists names only. `.env*` files are git-ignored. Separate keys for staging and production.
- `service_role` never appears in `src/`, tests, CI build env, logs or chat. CI greps `dist/` to prove it.
- Passwords of OpenSourcePOS, Supabase, GitHub, Cloudflare are never written in code, docs, issues or prompts.
  A password shared in chat by mistake is changed the same day.

## 4. Input validation

- Every command validates input with zod schemas in `src/domain/schemas.ts` before touching Dexie.
- Every RPC re-validates: allow-listed table, expected keys only, types, ranges (qty > 0, amounts ≥ 0, money integers),
  references exist and belong to the same company, business rules (e.g. return ≤ sold).
- Barcode-scanner input is treated as untrusted text (length ≤ 64, printable characters only).
- Imported OSPOS data is untrusted: strip HTML, normalise Arabic, validate like user input.

## 5. API security

- All traffic HTTPS. Cloudflare `_headers`: CSP (self + the Supabase project only), `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'`, `Permissions-Policy` minimal.
- Rate limits per `docs/API.md` §7. No endpoint returns stack traces or SQL errors to the client.
- `import_batch` callable only with the service role.

## 6. Data protection

- Collect only: name, phone, optional address/company for customers and suppliers. No national ID in the MVP.
- IndexedDB is not encrypted: phones pull the minimum for their role; managers' cost data stays off cashier phones.
- Local backups are AES-GCM encrypted with a key derived (PBKDF2) from the manager's passphrase.
- Server backups (nightly `pg_dump`) are GPG-encrypted before upload as a 30-day artifact.
- `migration-data/` (real OSPOS export and images) is git-ignored, stays on the Mac, and is deleted after go-live + 30 days.
- A customer can ask to correct or delete their personal data: anonymise the customer row (name → "عميل محذوف",
  phone cleared); keep financial documents for the legal retention period.

## 7. Error handling and logging

- Users see short Arabic messages + icon + sound, never internal details, file paths, SQL or keys.
- `client_errors` stores message, stack, app version, context — never PINs, passwords, tokens, full customer records.
- Audit log (append-only) records every sensitive action (`docs/DATABASE.md` §4.6) and is never editable.

## 8. Dependencies and infrastructure

- Lockfile committed; `npm ci` in CI; Dependabot weekly; `osv-scanner` on every push; no critical/high allowed.
- New dependency needs one line of justification in the PR; prefer small, maintained, MIT/Apache libraries.
- GitHub repository is private. 2FA on GitHub, Cloudflare, Supabase accounts.
- Branch protection is not available on GitHub Free private repos: merge only PRs whose CI is green.

## 9. Incident playbook

| Incident                                          | First actions                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Device lost or stolen                             | `revoke_device`, change that device's account password, check audit log for its last actions                             |
| Secret leaked (key in a commit, password in chat) | rotate it immediately, purge it from git history if committed, note it in `docs/costs.md` log                            |
| Suspected cash tampering                          | exceptions report + audit log for the shift; compare blind close variance                                                |
| Bad migration on production                       | stop deploys, devices keep selling offline, write a forward fix migration, restore from last backup only if data is lost |

## 10. AI agent rules

The coding agent must:

- Never invent, hard-code or print real credentials; never ask the user to paste a password into chat.
- Never disable RLS, auth, PIN checks or validation to make a feature or test pass.
- Never put `service_role` or any secret in client code or CI build env.
- Never read `migration-data/` in a cloud session, never paste real customer data into the conversation, tests or fixtures.
- Never run destructive commands against staging or production databases.
- Ask before changing: permission matrix, RLS policies, money rounding, document immutability, sync conflict rules.
