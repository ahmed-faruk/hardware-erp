---
name: pos-ui-low-literacy
description: UI rules for cashier screens usable by people who cannot read - icons, photos, fixed colors, sounds, spoken totals, banknote change, RTL, responsive breakpoints. Use for any work in src/ui.
---

# POS UI for low-literacy users (Arabic, RTL, responsive)

The cashier recognises products by PHOTO, buttons by ICON + COLOR + FIXED POSITION, results by SOUND.
Numbers are the only text that matters on cashier screens. Words stay under icons for people who read,
but no step may depend on reading them. Tokens, components and breakpoints are defined in `docs/DESIGN_SYSTEM.md` (source of truth); this skill adds the how-to.
Spec IDs UX-01..14, RSP-01..09: `docs/reference/mvp-plan.ar.md`.

## 1. Tokens (src/ui/tokens.css, CSS custom properties, light + dark)
| Token | Use | Icon (lucide-react) |
| --- | --- | --- |
| `--pay-cash` green | cash | `Banknote` |
| `--pay-credit` orange | credit / آجل | `NotebookPen` |
| `--pay-card` blue | card | `CreditCard` |
| `--pay-instapay` purple | InstaPay / wallet | `Smartphone` |
| `--ok` green, `--danger` red, `--warn` amber | results | `CircleCheck`, `CircleX`, `TriangleAlert` |
| `--cat-1..8` | category tiles | category icon chosen by manager |
Never use color alone: every colored state also has an icon or shape (color-blind users).
Font: self-hosted Cairo (OFL) woff2 subset in `public/fonts/` — no runtime CDN. `font-variant-numeric: tabular-nums`.
Digits: setting `latn` (123) or `arab` (١٢٣) applied through `Intl.NumberFormat('ar-EG', { numberingSystem })`.

## 2. Sizes
- Cashier touch targets ≥ 56 px; elsewhere ≥ 44 px. 8 px spacing grid.
- Type scale with `clamp()`: total `clamp(32px, 5vw, 64px)`; prices `clamp(18px, 2.2vw, 28px)`; labels ≥ 14 px.
- Max 2 menu levels. Max 3 steps per flow: items → pay → print.

## 3. Components (src/ui/components)
| Component | Behavior |
| --- | --- |
| `ProductTile` | photo (or category icon + color + large code), big price, stock dot; tap = add 1 |
| `CartLine` | thumbnail, name (small), `QtyStepper` (− qty +), line total big; swipe/✕ removes with `UndoToast` |
| `QtyStepper` + `NumPad` | big digits, decimal key only when unit allows fractions; no free text |
| `PayMethodButton` | fixed color/icon per method, same order everywhere |
| `ChangeDisplay` | change amount big + drawings of the notes/coins to hand back (from `breakChange`). Stylized drawings in note colors, not photos of real currency |
| `CustomerPicker` | grid of customer photos/initial avatars; filter by typing phone digits |
| `PinPad` | manager approval for risky actions instead of a text confirmation |
| `BigAlert` | full-width icon + color + sound; text optional |
| `UndoToast` | 5 s undo instead of "are you sure?" |
| `SyncStatus` | always visible: dot (green/grey), pending count, last sync time |
| `WorkerSwitch` | photo grid of workers + PIN; no username typing |

## 4. Input
- Barcode scanner works anywhere on the cashier screen: global key listener detects a burst (< 30 ms between keys, ends with Enter) and adds the item even if no field is focused.
- Search box is optional, normalises Arabic (أ إ آ→ا، ة→ه، ى→ي، strip tashkeel) and matches partial words and codes.
- Never require typing a name. Customers by photo or phone digits; products by photo, category, or barcode.

## 5. Sound (public/sounds/, preloaded, works offline and on Windows 7)
- `ok.mp3` on item added, `error.mp3` on any rejection (distinct pitch), `paid.mp3` on sale complete.
- Speak total and change with recorded Egyptian-Arabic clips (setting can turn speech off). Compose:
  - units 0–19: صفر واحد اتنين تلاتة أربعة خمسة ستة سبعة تمانية تسعة عشرة حداشر اتناشر تلتاشر أربعتاشر خمستاشر ستاشر سبعتاشر تمنتاشر تسعتاشر
  - tens: عشرين تلاتين أربعين خمسين ستين سبعين تمانين تسعين — order is units "و" tens: 75 = خمسة و سبعين
  - hundreds: مية ميتين تلتمية ربعمية خمسمية ستمية سبعمية تمنمية تسعمية
  - thousands t: 1 ألف · 2 ألفين · 3–10 construct form (تلات أربع خمس ست سبع تمن تسع عشر) + تلاف · ≥11 number(t) + ألف
  - words: جنيه، قرش، و، الإجمالي، الباقي
  - example 1,275.50 → "ألف و ميتين و خمسة و سبعين جنيه و خمسين قرش"
- `speakAmount(piasters)` builds the clip list (pure function, unit-tested) and plays it with one `AudioContext` queue.
  Do not depend on `speechSynthesis` (Arabic voices are missing on many PCs, including Windows 7).

## 6. Responsive layouts (CSS only; JS uses `matchMedia` only to choose drawer vs pane)
| Width | Cashier layout |
| --- | --- |
| < 360 | 1 column, 2-column photo grid, cart = bottom sheet, pay = full screen |
| 360–599 | 3-column grid, sticky total bar at bottom, bottom tab nav |
| 600–899 | 4-column grid, cart = side drawer |
| 900–1279 | two panes: products + cart (1024×768 POS screens) |
| 1280–1919 | two panes + fixed category rail |
| ≥ 1920 | three panes (categories, products, cart), max content width, scaled type |
Rules: mobile-first `min-width` queries; photo grid `repeat(auto-fill, minmax(clamp(96px, 12vw, 160px), 1fr))`;
components use container queries; `dvh` for full-height; `(pointer: coarse)` enlarges targets; hover effects only
in `(hover: hover)`; logical properties only (`margin-inline-start`, never `left/right`); `env(safe-area-inset-*)`;
works at 200% zoom and both orientations; `prefers-reduced-motion` disables animations.

## 7. Accessibility and text
- Every icon button: Arabic `aria-label`. HTML `lang="ar" dir="rtl"`.
- Error = icon + color + sound + short Arabic word; never a paragraph.
- All UI strings in `src/ui/strings.ar.ts` (no hard-coded text in components).

## 8. Definition of done for any cashier screen
- Works with keyboard only, touch only, and scanner only.
- Screenshot tests pass at 320×568, 360×800, 390×844, 768×1024, 1024×768, 1280×1024, 1366×768, 1920×1080, 2560×1440.
- Tried with the real worker: completes a 5-item sale alone after 15 min of training (log result in `docs/ux-trials.md`).
