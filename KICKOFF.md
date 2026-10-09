# KICKOFF — instructions for Claude Code (the owner does not code)

The owner opened this folder in VS Code and said "نفّذ KICKOFF.md". Do the whole MVP yourself, end to end.
Talk to the owner in short Egyptian Arabic, no jargon. Only stop for things only he can do (listed below).

## 0. Ground rules
- Read `CLAUDE.md` / `AGENTS.md` first. Follow `docs/` and the skills in `.claude/skills/`.
- Work phase by phase (section 3). After each phase: run its tests, commit, and send the owner one line:
  what now works + what he can try.
- **No decisions of your own.** Build only what `docs/` and the skills say. If something is not written there
  (a feature, a rule, a screen, a library, a number), STOP and ask the owner one short Arabic question with
  2–3 options and your recommendation marked. Never fill a gap silently, never add features "while you're at it".
- Purely internal choices that change nothing the owner sees (variable names, file split, test layout) need no question.
- Open questions in `docs/PRD.md` §11: ask the owner each one when its phase starts.
- Model: Sonnet for everything (set in `.claude/settings.json`). Use `/compact` between phases.

## 1. Prepare the machine (ask before installing anything)
1. Check: `node -v`, `git --version`, `docker --version`, `brew --version`, `gh --version`, `supabase --version`.
2. Install what is missing with Homebrew (`brew install node git gh supabase/tap/supabase`, `brew install --cask docker`).
   If Homebrew itself is missing, show the owner the one install command and ask him to paste it in Terminal
   (it needs his Mac password, which you must never ask for or type).
3. Start Docker Desktop (`open -a Docker`) and wait until `docker info` works.

## 2. Put the data in place
1. Find `~/Downloads/ospos-export-*.json` (≈ 70 MB, exported from OpenSourcePOS on 9 Oct 2026).
2. `mkdir -p migration-data && mv ~/Downloads/ospos-export-*.json migration-data/`
3. Confirm `migration-data/` is in `.gitignore` before any commit. Never print customer rows.
4. If the file is missing, tell the owner: "الملف مش في Downloads؛ ابعتلي مكانه".

## 3. Build (phases = `docs/reference/mvp-plan.ar.md` §8.2)
1. `git init -b main`, first commit of the docs and skills.
2. Phase 1 scaffold + CI files · 2 domain library + unit tests · 3 Dexie/Supabase schema + sync (`supabase start`)
   · 4 OSPOS import (`tools/ospos-import`) into local Supabase + validation report · 5 master-data screens
   · 6 cashier screen + printing · 7 returns, collections, purchases, supplier payments · 8 shift, expenses, reports
   · 9 full e2e / performance / security run.
3. After phase 6, run `npm run dev -- --host` and tell the owner the local link to try on the Mac
   and on his phone (same Wi-Fi).
4. Opening balances: OSPOS has no credit records. Generate `migration-data/opening-balances.xlsx`
   (every customer and supplier, balance 0) and ask the owner to fill in who owes what, then import it.

## 4. Publish the link (needs the owner only to click "approve" in the browser)
1. `gh auth login --web` → owner approves in the browser → `gh repo create hardware-erp --private --source . --push`.
2. `npx wrangler login` → owner approves (creates a free Cloudflare account if he has none) →
   create Pages project `hanafy-pos`.
3. `supabase login` → owner approves → create projects `hanafy-staging` and `hanafy-production` (region Frankfurt)
   with `supabase projects create` (generate strong DB passwords yourself, store them only in GitHub secrets via `gh secret set`).
4. Set every secret/variable in `.claude/skills/ci-cd-deploy/SKILL.md` §2 with `gh secret set` / `gh variable set`.
5. Push to `main`; wait for `deploy` to go green; import the OSPOS data into production with the service-role key kept
   only in `tools/ospos-import/.env.local`.
6. Give the owner the final link `https://hanafy-pos.pages.dev`, a test login (photo + PIN) for each role, and the
   validation report summary.

## 5. Only the owner can
- Approve installs and the 3 browser logins (GitHub, Cloudflare, Supabase); type his Mac password if Homebrew asks.
- Fill the opening balances sheet.
- Try the cashier screen with the real cashier.
- Change the OpenSourcePOS password (it was shared in a chat).
