# OpenSourcePOS browser export

Read-only export of the shop's OSPOS 3.3.3 data, used because the OSPOS backup button returns HTTP 500 and there is
no phpMyAdmin access. Format and import rules: `.claude/skills/ospos-migration/reference.md`.

## Run it

1. The owner logs in to OSPOS in Chrome (nobody else types his password).
2. In that tab, run `export.js`:
   - with Claude in Chrome: `javascript_tool` with the file content, then poll `window.__osposExport`;
   - or by hand: View → Developer → JavaScript Console, paste the file, press Enter.
3. Wait for `window.__osposExport.status === 'done'` (~15 minutes for ~68,500 sales; the shop can keep using OSPOS).
4. Run `window.__osposDownload()` → `ospos-export-YYYY-MM-DD.json` is saved to Downloads.
5. Move it to `migration-data/` (git-ignored). Never upload it anywhere else.

## What it reads (GET only)

Items list, inventory summary report, customers and suppliers lists + edit forms, employees list, expenses list,
detailed sales and detailed receivings reports month by month since the first sale.

## Known limits

- Deleted OSPOS items/customers are not listed; history lines that reference them keep their text.
- Report dates have no time of day.
- Item photos are referenced by URL (`item_pic_url`) and downloaded by the import tool.
