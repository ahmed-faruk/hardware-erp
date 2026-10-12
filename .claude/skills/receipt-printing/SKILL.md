---
name: receipt-printing
description: Printing for the POS - 58/80 mm thermal and A4 HTML templates in Arabic RTL, silent printing in Firefox/Chrome, cash drawer via printer driver, reprint rules. Use for any print or receipt work.
---

# Receipt printing

The browser cannot send raw ESC/POS bytes. We print HTML through the OS printer driver.

## 1. Templates (src/ui/print/)
- `Receipt58`, `Receipt80`, `A4Document` (statements, purchase docs, reports). Pure components: data in, markup out.
- Printable width: 80 mm paper → 72 mm; 58 mm paper → 48 mm. Set with CSS, not pixels:
```css
@page { size: 80mm auto; margin: 0; }
@media print { html, body { width: 72mm; margin: 0; } .no-print { display: none; } }
```
- Fonts: same self-hosted Cairo; body 11–12 pt, totals 16 pt bold. Black only, no backgrounds. Logo = 1-bit PNG ≤ 40 mm wide.
- `dir="rtl"`; numbers use the digit setting; money right-aligned columns with `tabular-nums`.

## 2. Receipt content (sales invoice)
Shop name/logo/phone · document number (`K1-INV-000245`) · date-time (Africa/Cairo) · cashier name ·
lines (name, qty × price, line total) · discount · TOTAL (largest) · payments by method · cash tendered + change ·
for credit sales: customer name + previous balance + this invoice + new balance · return policy line ·
footer from settings. Returns print "مرتجع" banner; reprints print "نسخة" banner and are audit-logged.

## 3. How to print
- Render the template into a hidden `iframe` (`srcdoc`), wait for fonts (`document.fonts.ready`) and the logo image, then `iframe.contentWindow.print()`.
- Printing must not block the next sale: sale is already saved before printing starts.
- Failure or cancel → the sale stays saved; show a "print again" button.

## 4. Silent printing setup (document it in `docs/shop-setup.md`, it is a one-time setting per PC)
- Firefox (Windows 7 shop PCs): `about:config` → `print.always_print_silent = true`; set the thermal printer as the
  OS default printer; margins none and headers/footers off in the print dialog once.
- Chrome/Edge: launch shortcut with `--kiosk-printing`.
- Cash drawer: enable "open cash drawer" (before/after print) in the thermal printer driver properties. Most
  58/80 mm drivers (Epson, Xprinter and similar) have it. The drawer then opens on every receipt.
- "No-sale" drawer open = print a short slip with reason + worker (audited), which triggers the drawer.

## 5. Paper and settings
Settings per device (local, not synced): paper `58 | 80 | A4`, copies, no automatic printing (the cashier presses «اطبع» / «اطبع تاني»; a no-sale drawer open still prints its slip because that is how the drawer opens),
print logo (on/off). A4 for statements always uses the default A4 printer via the normal dialog.

## 6. Tests
- Snapshot test of each template with a fixed fixture (Arabic text, 30 lines, long names, credit sale).
- Playwright `page.emulateMedia({ media: 'print' })` + `page.pdf({ width: '80mm' })` must produce one page
  per short receipt and wrap long names without cutting digits.
