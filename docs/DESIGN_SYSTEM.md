# Design System

Every screen uses these tokens and components so the app feels like one product. Cashier screens must work for
people who cannot read: they recognise products by **photo**, buttons by **icon + color + fixed position**, results
by **sound**. Numbers are the only text that matters on cashier screens; words sit under icons for people who read.

## 1. Direction
**The workshop counter** (redesign, Oct 2026): a dark ink top bar and rail, a concrete-grey canvas, paper-white cards,
and one safety-orange action per screen region. Products carry their paint-swatch color. The cart reads like a paper
ticket (dashed rules). Big, calm, always in the same place. Motion is short and informative (≤ 400 ms: a line sliding
into the cart, a checkmark drawing itself, numbers counting to the new total); it never delays the cashier and stops
under `prefers-reduced-motion`. Gradients stay out; soft tinted shadows (`--shadow-1/2`) separate cards from the canvas.

## 2. Color tokens (`src/ui/tokens.css`)
Light is default; dark under `@media (prefers-color-scheme: dark)` and `[data-theme="dark"]`. White text on every
action color passes WCAG AA (≥ 4.5:1).

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | `#E9E7E2` | `#10161C` | page |
| `--surface` | `#FBFAF7` | `#19212A` | cards, panes |
| `--surface-2` | `#EFEDE7` | `#232D38` | photo placeholder, input background |
| `--border` | `#D6D3CB` | `#2B3643` | dividers, outlines |
| `--text` | `#16202B` | `#EEF1F4` | main text and numbers |
| `--text-muted` | `#5D6672` | `#9AA5B2` | labels under icons |
| `--primary` | `#C94A00` | `#FF7A33` | the one action, focus ring (safety orange) |
| `--primary-strong` | `#A63C00` | `#FFA070` | primary hover |
| `--ink`, `--ink-2` | `#16202B`, `#223142` | `#0A0F14`, `#1A2531` | top bar, side rail, selected category |
| `--border-strong` | `#B9B5AB` | `#46546A` | input and ghost-button outlines |
| `--ok` | `#15803D` | `#4ADE80` | success, cash |
| `--danger` | `#B91C1C` | `#F87171` | error, void, delete |
| `--warn` | `#B45309` | `#FBBF24` | warning, needs approval |
| `--pay-cash` | `#15803D` | `#4ADE80` | نقدي — icon `Banknote` |
| `--pay-credit` | `#C2410C` | `#FB923C` | آجل — icon `NotebookPen` |
| `--pay-card` | `#2B6CB0` | `#7DB4EE` | فيزا — icon `CreditCard` |
| `--pay-instapay` | `#7E22CE` | `#C084FC` | إنستاباي / محفظة — icon `Smartphone` |
| `--cat-1 … --cat-8` | `#2563EB #EA580C #16A34A #9333EA #DB2777 #0891B2 #CA8A04 #4B5563` | same hues, +20% lightness | category tiles and chips |
| `--tint-*` | the color at 12% opacity | 18% opacity | backgrounds of colored buttons/chips |
Rules: color never carries meaning alone (always an icon or shape too); the payment colors are reserved for payment
and never reused for anything else; one accent per screen region.

## 3. Typography
- Font: **Cairo** (SIL OFL), self-hosted woff2 subset (Arabic + Latin + digits) in `public/fonts/`; fallback `Tahoma, Arial, sans-serif`
  (present on Windows 7). No runtime font CDN.
- Numbers: `font-variant-numeric: tabular-nums`. Digit style setting: `latn` (123) or `arab` (١٢٣) via `Intl.NumberFormat('ar-EG', { numberingSystem })`.

| Style | Size / line height / weight | Use |
| --- | --- | --- |
| `total` | `clamp(32px, 5vw, 64px)` / 1.1 / 700 | invoice total, change |
| `price` | `clamp(18px, 2.2vw, 28px)` / 1.2 / 700 | tile price, line total |
| `h1` | 28 / 36 / 700 | screen title (manager screens) |
| `h2` | 22 / 30 / 600 | section title |
| `body` | 16 / 24 / 400 | default |
| `label` | 14 / 20 / 600 | word under an icon |
| `small` | 13 / 18 / 400 | secondary info (never below 13 px) |

## 4. Spacing, radius, elevation
- Spacing scale (px): 4, 8, 12, 16, 24, 32, 48, 64. Components use 8-multiples.
- Radius: 12 (buttons, inputs), 14 (cards, tiles), 16 (dialogs), 999 (chips, avatars).
- Elevation: `--shadow-1` for cards and tiles, `--shadow-2` for the phone total bar, `--shadow-dialog` for dialogs.
- Touch targets: ≥ 56 px on cashier screens, ≥ 44 px elsewhere; ≥ 8 px gap between targets.

## 5. Icons and sounds
- Icons: `lucide-react` (MIT), stroke 2, size 28 on cashier buttons, 20 elsewhere. Custom SVGs for EGP notes/coins
  (stylised in the note's color with its value — never photos of real currency).
- Fixed icon meanings: `ScanBarcode` scan, `Search` search, `Plus`/`Minus` qty, `Trash2` remove, `Undo2` undo,
  `PauseCircle` hold cart, `Printer` print, `User` customer, `Lock` manager PIN, `RefreshCw` sync, `WifiOff` offline,
  `CircleCheck` ok, `CircleX` error, `TriangleAlert` warning, `Volume2` speak total.
- Sounds (`public/sounds/`, preloaded): `ok.mp3` item added, `error.mp3` rejected (different pitch), `paid.mp3` sale done,
  plus ~60 recorded Egyptian-Arabic clips to speak any amount (see skill `pos-ui-low-literacy` §5). Setting: sounds on/off, speech on/off.

### Icon catalog for categories and products
The manager picks an icon for a category and (optionally) for a single product; tiles without a photo show it on the category color.
`src/ui/icons/catalog.ts` holds 85 icons: 77 from Lucide (already a dependency, ISC) plus 8 hand-drawn in the same style for what
Lucide lacks (screwdriver, saw, pliers, pipe, tape measure, nails, socket, light switch, in `icons/custom.tsx`). All are bundled in the
app, so they work offline with no CDN. Arabic names and search words live in `strings.ar.ts` (`iconItems`). The stored value is the
key string: `categories.icon`, and `products.extra_fields.icon` for a single product. Unknown or empty key → the generic box.
Photos are not built yet (open item, decided with the cashier screens).

## 6. Components (`src/ui/components`) and their states
Every component defines: default, hover (only with `(hover: hover)`), focus-visible (3 px `--primary` ring, 2 px offset),
active/pressed (scale .97), disabled (40% opacity + `aria-disabled`), loading (spinner replaces icon, keeps size).

| Component | Spec |
| --- | --- |
| `ActionButton` | icon on top + label under; variants `primary` (solid orange, one per region), `soft` (tinted, secondary), `ghost` (neutral outline, tertiary), `ok`, `danger`; min 56×56 on cashier |
| `ProductTile` | 1:1 photo (or category icon on `--cat-n` tint + big code), name (2 lines max, `small`), price (`price`), stock dot (ok/warn/danger). Tap adds 1; long-press opens qty |
| `CartLine` | thumbnail 40 px, name (`small`), `QtyStepper`, line total (`price`); remove → `UndoToast` |
| `QtyStepper` | − [qty] +, 56 px buttons; tap qty opens `NumPad` |
| `NumPad` | 3×4 grid of 64 px keys, decimal key only if the unit allows fractions, big display, OK = `--ok` |
| `PayMethodButton` | fixed order: cash, credit, card, InstaPay; color + icon from §2 |
| `TotalBar` | label + total (`total`) + `Volume2` speak button; sticky at bottom on phones |
| `ChangeDisplay` | change amount (`total`) + note/coin drawings from `breakChange` |
| `CustomerPicker` | grid of photos/initial avatars; filter by typing phone digits on `NumPad` |
| `WorkerSwitch` | grid of worker photos → `PinPad` |
| `PinPad` | 6 dots + `NumPad`; wrong PIN = shake + `error.mp3` |
| `BigAlert` | full-width band: icon 48 px + color + sound + optional short word |
| `UndoToast` | 5 s with countdown ring and `Undo2` |
| `SyncStatus` | dot (green online / grey offline / amber pending), pending count, last sync time; always visible in the top bar |
| `EmptyState` | large icon + one short word + one action button |
| Manager-only: `DataTable`, `FormField` (label, input, helper, error), `Dialog`, `Tabs`, `DateRange` | text allowed, same tokens |
States for data: loading = skeleton blocks the size of content; empty = `EmptyState`; error = `BigAlert` with retry.

### Cashier screen (phase 6)
Route `#/sell`. Tiles without a photo show the category icon on its color, the product code, the price and a stock dot. Fixed pay buttons:
cash green, credit orange, card blue, InstaPay purple. Defaults of prd-v2 §16.3 for keys (F2 search, F4 customer, F8 hold, Shift+F8 held carts,
F9 pay, Ctrl+Enter finish, Esc). All cashier buttons are 56 px high. The change is drawn as notes and coins (never photos of real money).

## 7. Screen patterns
- Cashier flow is 3 steps with fixed colors: items (neutral) → pay (card with a 5 px `--primary` top edge, two columns from 900 px) → done (card with an `--ok` top edge + receipt). The cashier has no navigation: the sale gets the full width.
- Max 2 menu levels. Primary action bottom-end (RTL: bottom-left) on phones, end of the pay panel on desktop.
- Risky actions (void, return without invoice, big discount, price change, credit over limit, no-sale drawer) ask for
  `PinPad` — never a text "Are you sure?". Reversible actions use `UndoToast` instead of confirmation.

## 8. Responsive rules
Mobile-first `min-width` queries; components use container queries; layout decided by CSS, JS only picks drawer vs pane via `matchMedia`.

| Width | Cashier layout | Navigation |
| --- | --- | --- |
| < 360 | 1 column; photo grid 2 columns; cart = bottom sheet; pay = full screen | bottom tabs |
| 360–599 | photo grid 3 columns; sticky `TotalBar` | bottom tabs |
| 600–899 | photo grid 4 columns; cart = side drawer | bottom tabs |
| 900–1279 | two panes: products + cart (1024×768 counter PCs) | side rail |
| 1280–1919 | two panes + fixed category rail | side rail |
| ≥ 1920 | three panes (categories, products, cart), content max 1800 px, type scales by `clamp()` | side rail |
- Photo grid: `grid-template-columns: repeat(auto-fill, minmax(clamp(96px, 12vw, 160px), 1fr))`.
- Heights with `dvh`; safe areas with `env(safe-area-inset-*)`; `(pointer: coarse)` enlarges targets.
- Logical properties only (`margin-inline-start`, `inset-inline-end`, `text-align: start`); `dir="rtl"` on `<html>`.
- Works at 200% browser zoom and in both orientations.
- Test viewports: 320×568, 360×800, 390×844, 768×1024, 1024×768, 1280×1024, 1366×768, 1920×1080, 2560×1440.

## 9. Print
Separate print CSS per paper: 58 mm (printable 48 mm), 80 mm (72 mm), A4. Black only, Cairo 11–12 pt, total 16 pt bold,
logo 1-bit ≤ 40 mm. Details: skill `receipt-printing`.

## 10. Accessibility
- Contrast AA for text and icons; focus always visible; every icon button has an Arabic `aria-label`.
- Full keyboard path on cashier screens (`docs/PRD.md` §8); barcode scanner works without focusing a field.
- `prefers-reduced-motion` disables all non-essential motion. No information by color alone.
- Copy: Arabic, short (≤ 3 words under an icon), the same word for the same thing everywhere; all strings in `src/ui/strings.ar.ts`.
