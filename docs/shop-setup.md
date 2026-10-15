# Shop setup (one time per PC)

## 1. Printing receipts without a dialog

The app prints through the OS printer driver, so every sale prints by itself once these settings are done.

**Firefox ESR 115 (the Windows 7 shop PCs)**

1. Set the thermal printer as the Windows **default printer**.
2. Open `about:config`, accept the warning, search `print.always_print_silent`, set it to `true`.
3. Print any page once (Ctrl+P) and in the dialog set margins to none and turn headers and footers off; the setting is remembered.

**Chrome or Edge:** start the browser from a shortcut with `--kiosk-printing` added at the end of the Target.

**Paper size:** in the app, Settings → This device → paper size (80 mm or 58 mm). The page size in the printer driver should be the same.

## 2. Cash drawer

The drawer is plugged into the thermal printer. In the printer driver properties turn on **open cash drawer** (before or after printing).
It then opens on every receipt. "Open drawer" without a sale prints a short slip with the reason, which opens it too.

## 3. Barcode scanner

A USB scanner that types the code and presses Enter works as is. Test: scan any product on the sale screen. The receipt's invoice number is
also a Code 128 barcode: scan it with the same scanner (later used for returns); the first printed receipt should be test-scanned.

## 4. Register the PC (done by the owner on the Mac)

```
npm run device:add -- --name "كاشير 1" --prefix K1 --kind pc --role cashier
```

It prints a one-time code (valid 24 hours) and creates the device's cash drawer account. Type the code on the PC at first start.
A cashier-level device never receives item costs; the server fills the cost of every sold line.

## 5. Settings the manager sets (Settings screen)

- May the cashier give a discount, and up to what percent; may the cashier change a price. Anything else asks for a manager's PIN.
- Shop phone, address and the footer line printed on every receipt.
