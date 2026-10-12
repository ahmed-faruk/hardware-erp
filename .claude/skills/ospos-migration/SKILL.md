---
name: ospos-migration
description: Migrate this shop's OpenSourcePOS 3.3.3 data from the browser export JSON into the new POS - products, stock, customers, suppliers, history, images - with a validation report. Use for tools/ospos-*.
---

# OpenSourcePOS 3.3.3 → Hanafy POS

The OSPOS backup button returns HTTP 500 and there is no phpMyAdmin access, so the source is a **browser export**:
`tools/ospos-export/export.js` runs in a logged-in OSPOS tab, reads OSPOS's own list pages and reports (GET only) and
saves `ospos-export-YYYY-MM-DD.json`. Field-by-field format and mapping: [reference.md](reference.md).

## 0. Data handling (strict)
- The export and images live in `migration-data/` on the Mac. Git-ignored. Never commit, never open in a cloud session,
  never paste rows into the conversation. Print counts and at most 3 sample rows with phones masked.
- The service-role key is read from `tools/ospos-import/.env.local` (git-ignored) only.

## 1. Producing the export (owner + Claude in Chrome, or owner alone)
1. Owner logs in to OSPOS in Chrome himself (never type his password for him).
2. In that tab run `tools/ospos-export/export.js` (Claude in Chrome `javascript_tool`, or DevTools console).
   It runs in the background (~15 min for ~68k sales); poll `window.__osposExport.status/step/progress`.
3. When `status === 'done'`, ask the owner's permission, then call `window.__osposDownload()` → the JSON lands in Downloads.
4. Owner moves it to `migration-data/`. Run it again on cutover day for the final data.

## 2. Import pipeline (`tools/ospos-import`, Node + TypeScript, `npm run import -- <step>`)
1. `read` — load the JSON, check `meta.format === 'ospos-browser-export/1'`, print `meta.counts` and `meta.errors`.
2. `parse` — money strings → piasters, quantities → milli, d/m/Y dates → ISO (Africa/Cairo), payment strings → parts
   (reference.md §4). Write `out/parsed/*.jsonl`.
3. `match` — link sale/receiving lines to products (barcode → exact name → normalised name), sales to customers
   by full name, receivings to suppliers by company name. Unmatched → keep text, list in the report.
4. `transform` — new schema rows (`docs/DATABASE.md`), ids = UUID v5 of `"ospos:<kind>:<id>"` (fixed namespace) so re-runs
   never duplicate. History rows get `is_legacy = true` and NO ledger rows.
5. `balances` — `out/opening-balances.xlsx`: suggested customer/supplier balances (reference.md §6) for the owner to
   correct and approve. Stock openings = OSPOS quantities exactly (inventory_summary).
6. `images` — download each `item_pic_url` (public URL), resize to 256 px WebP (sharp), upload to `product-images`.
   First export: no product has a photo (`item_pic_url` empty for all 1,406) — skip unless photos were added since.
7. `load-target` — the history goes in compact form (`compact.ts` → `import_legacy_batch`: `legacy_sales`, `legacy_sale_lines`, `legacy_purchases`, `legacy_purchase_lines`); everything else through the `import_batch` RPC (service role), batches of 500: staging first, then production.
8. `validate` — `out/validation-report.md`; exit ≠ 0 if a blocking check fails.

## 3. Rules
- Products: 1,406 active items in one location ("stock" → main warehouse). Deleted OSPOS items are not in the export;
  history lines that point to them stay as text.
- Item names may carry a pack suffix when OSPOS multi-pack is on (`NAME_SEPARATOR` + pack name) — strip it into the unit.
- Sales: `type_code` "نقطة بيع" / "كود الفواتير الرسمية" → sales invoice; "كود عمليات المرتجع" → sales return
  (quantities negative in OSPOS, store positive). Report totals are per sale; time of day is not in the export.
- Receivings: quantity `"2.00 x 12.00"` = 2 packs × 12 units; negative quantity = purchase return; a receiving with
  zero items purchased is a requisition (stock move) — report it, do not import as a purchase.
- Payment labels are Arabic UI text ("نقدى", "مستحق", "بطاقة إئتمانية", "بطاقة خصم", "شيك") — map with reference.md §5;
  unknown labels → `other` + report.
- Employees: names only, as legacy workers. Never import or ask for passwords.

## 4. Cutover
Close the day in OSPOS → fresh export → `read … validate` on production → owner signs the report → selling starts in the
new system next morning. OSPOS stays available read-only for one month.

## 5. Validation report
| Check | Rule | Blocking |
| --- | --- | --- |
| Counts | products, customers, suppliers, sales, receivings, expenses equal `meta.counts` minus listed skips | yes |
| Sales coverage | exported sales ≈ `meta.salesSearchTotal` minus canceled/suspended/quotes; any month with 0 sales flagged | yes |
| Monthly sales totals | sum of `total` per month equals OSPOS "Summary sales" report for 3 sampled months | yes |
| Stock | every product's opening qty equals inventory_summary quantity | yes |
| Opening balances | equal the approved xlsx | yes |
| Sample | 20 random sales: lines, totals and payments match the export | yes |
| Warnings | unmatched lines, duplicate barcodes, items without price/category/image, unknown payment labels, export errors | no |
