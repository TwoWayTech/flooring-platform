# Design plan

How docs/design-brief.md becomes code. The brief fixes the palette, type, shape and the signature element; this plan turns those into tokens, decides what the brief leaves open, and records the review against the brief's avoid-list.

## 1. Tokens

All colors are CSS variables in `packages/ui/src/styles/globals.css`, defined for `:root` (light) and `.dark`, and exposed to Tailwind with `@theme inline` (CLAUDE.md rule 6). Components use semantic names only.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--background` | Limestone #EEF0EC | #152024 | App canvas, sidebar, top bar |
| `--surface` (`card`, `popover`) | Paper #FAFBF9 | #1D2B31 | Panels, tables, inputs, menus |
| `--raised` | #F3F5F2 | #24343B | Table header, hover tint, selected row base |
| `--hairline` (`border`, `input`) | Grout #CDD3CD | #31444C | Dividers, input borders, grid lines |
| `--foreground` | Slate #1F2B30 | #E6EBE8 | Text |
| `--muted-foreground` | #5B6A6E | #9FB0AE | Secondary text (5.3:1 on Paper) |
| `--oak` | #B8894D | #D3A867 | Roll gauge, stock levels, second chart series |
| `--oak-ink` | #8A6330 | #D3A867 | Oak as text (AA on Paper) |
| `--success` / `--warning` / `--danger` | Moss #3F8F55 / Amber #C98A1E / Brick #C2453D | brightened 12 % L | Status icon + word, never color alone |

**Brand accent from one color.** `brandTokens()` and a new `brandScale()` in `packages/shared/src/color.ts` derive, per theme: `--brand` (fill, white or dark text reaches 4.5:1), `--brand-foreground`, `--brand-ink` (accent as text, 4.5:1 on the background), `--brand-soft` (selected tint), and an OKLCH scale `--brand-50` … `--brand-900` at fixed lightness steps with chroma capped, used by the floor pattern and charts. A `BrandStyle` component writes these variables for the open company, so Settings → Branding changes the whole shell instantly. `checkBrandColor()` blocks colors under 3:1 on Paper.

**Type.** Unbounded 600/700 via `next/font/google` as `--font-display`; Instrument Sans 400/500/600 as `--font-sans`. Scale (minor third): 12, 13, 14 (base), 16, 19, 23, 28, 34, 41 px as `text-2xs` … `text-5xl`. Body line height 1.45, display 1.15 with −0.01em tracking. `tabular-nums` on every figure through `<Num>`. Unbounded appears once per region: the page title, the dashboard's key figures, the login wordmark.

**Shape and depth.** Radius 4 px (inputs, chips, pills), 8 px (panels), 14 px (dialogs, drawers, ⌘K). Tables are square inside their panel. No shadows except one floating-layer shadow (`--shadow-float`) on menus, ⌘K, drawers and toasts. 8 px spacing grid. Rows 36 px, compact 30 px; sticky headers; numbers right-aligned.

**Focus.** `outline: 2px solid var(--brand-ink); outline-offset: 2px` on `:focus-visible` everywhere, including table rows that open drawers.

## 2. Layout wireframes

App shell, 1440 px. Sidebar and top bar sit on the Limestone canvas; content panels are Paper. The only color in the chrome is the pattern swatch and the active item's tint.

```
+--------------+-------------------------------------------------------------+
| [pattern     |  [Search or run a command        Ctrl K]   bell  sun  DW v |
|  swatch]     +-------------------------------------------------------------+
| SF  Summit   |  Viewing as Sales. Costs and margins are hidden.  [Stop]    |  <- only when viewing as
|     Floor Co.|  Dashboard (Unbounded 28)                    [New quote]    |
|--------------|  +-------------------------------------------------------+  |
| Dashboard    |  | Paper panel                                           |  |
| Sales        |  |                                                       |  |
| Inventory    |  +-------------------------------------------------------+  |
| Purchasing   |                                                             |
| Installation |                                                             |
| HR           |                                                             |
| Meetings     |                                                             |
| Reports      |                                                             |
|--------------|                                                             |
| Settings     |                                                             |
| View as  v   |                                                             |
+--------------+-------------------------------------------------------------+
```

390 px: the sidebar becomes a left drawer opened from a menu button; the top bar keeps the menu button, the company monogram, search (icon only) and the avatar. Page actions move under the title. Tables become stacked rows with the primary figure right-aligned.

```
+--------------------------------+
| =  [SF]          search  bell  DW |
+--------------------------------+
| Dashboard                       |
| [New quote]                     |
| +----------------------------+ |
| | Revenue, 12 months         | |
| | key figures, 2 per row     | |
| | chart                      | |
| +----------------------------+ |
| Needs attention                 |
+--------------------------------+
```

Login: the company's pattern fills the viewport behind a single Paper panel on the left third; the pattern lays itself plank by plank once.

```
+------------------------------------------------------------------+
| ////// herringbone in brand-200 at low contrast, full bleed ///// |
|  +------------------------+                                       |
|  | Flooring Suite         |  (Unbounded wordmark)                 |
|  | 1 Company   [SF][KF]   |  swatch chips: pattern + monogram     |
|  | 2 Persona   cards      |  name, role, what they can see        |
|  | 3 Code      [ ][ ][ ]  |  hint: 123456                         |
|  | Platform admin (you)   |                                       |
|  +------------------------+                                       |
+------------------------------------------------------------------+
```

The numbered steps on the login panel are a real sequence (company, persona, code), so numbering is earned there and nowhere else. Dashboard, roll detail and quote builder follow the brief's wireframes as drawn.

## 3. Signature element and its companion

**Floor pattern** (`packages/ui/src/components/floor-pattern.tsx`). Planks are generated as SVG rects from the pattern's geometry: herringbone (45° alternating planks, 1:4 plank ratio), running bond (staggered rows at half and third offsets), basketweave (pairs of planks alternating direction in square cells). Fills step through `--brand-100 … --brand-300` with a hairline joint in `--background`, so the pattern reads as material, not as a gradient. Props: `pattern`, `animate` (login only), `size`. Animation: Motion staggers plank opacity and scale from 0.96 over about 1.2 s in laying order (row by row from the bottom-left corner, like an installer), then stops. With `prefers-reduced-motion`, planks render complete. The sidebar header carries a 40 × 40 static swatch.

**Roll gauge** (`roll-gauge.tsx`). A side view: on the left, the roll end as a circle whose area is proportional to the remaining length (radius ∝ √remaining), with spiral rings; to its right, a track the length of the original roll on a ft scale. The remaining part is Oak with a fine weave hatch, the used part is an empty Grout outline, and each cut is a notch tick at its position. Large version: scale labels every 25 ft, remaining value in Unbounded. Mini version (inventory rows): 96 × 16 px, no labels, notches only. Cutting animates the remaining bar shortening and the roll end shrinking (Motion spring, 400 ms), then a new notch drops in. Reduced motion: instant.

## 4. Components

shadcn/ui (Radix base) in `packages/ui`, restyled through the tokens: button, input, label, select, checkbox, switch, tabs, dialog, sheet (drawers), dropdown-menu, popover, tooltip, command (⌘K), table, badge (status pill), separator, skeleton, sonner, chart. Own components: `Num`, `StatusPill`, `FloorPattern`, `RollGauge`, `Swatch`, `PageHeader`, `Panel`, `EmptyState`, `Money` input with suffixes.

- Status pill: 4 px radius, icon + word, tinted background at 12 % of the state color, text in the state's ink. Draft, Sent, Accepted, Invoiced, Paid, Overdue.
- Buttons: primary is the brand fill; secondary is Paper with a Grout border; ghost for toolbars. Labels are verbs that match the result ("Convert to invoice" → "Invoice INV-1042 created").
- Forms: labels above, inline validation under the field in Brick with an icon, units as field suffixes (sq ft, %, ft).
- Charts: first series `--brand`, second `--oak`, then neutrals; tooltips through `<Num>`; drawn once on first render.

## 5. Review against the brief and its avoid-list

Checked each choice the brief leaves open against "would I produce this for any SaaS dashboard?" Revisions:

1. **Dashboard key figures.** First draft: four figure cards across the top. That is the SaaS-card kit the brief rules out. Revised: the figures sit in one row inside the revenue panel, separated by hairlines, directly above the chart they summarise, as the brief's wireframe shows.
2. **Active navigation.** First draft: a coloured bar on the left edge of the active item. Common default. Revised: the active item gets `--brand-soft` tint and `--brand-ink` text; the sidebar's only strong color stays the pattern swatch.
3. **Table header labels.** First draft: small uppercase tracked headers. On the avoid-list. Revised: sentence-case headers in 13 px medium muted text on `--raised`.
4. **Identifiers.** Roll numbers, SKUs and invoice numbers were tempting in monospace. On the avoid-list. Revised: Instrument Sans with tabular numerals.
5. **Login.** First draft: centred card over a gradient wash. Generic and on the avoid-list. Revised: the floor pattern is the background, the panel is anchored left, and the pattern is the one decorative motion in the product.
6. **Meta lines** such as "Dye lot 22B · 12 ft · Main warehouse" were drafted with middle dots. Revised: labelled fields in a definition row ("Dye lot 22B", "Width 12 ft") separated by spacing, never dots.
7. **Empty states** use one sentence and one action, no illustration, so the pattern stays the only decoration.

Kept from the brief without change: Limestone/Paper/Grout/Slate neutrals, Patina default accent, Oak for material, Unbounded plus Instrument Sans, radius hierarchy, no shadows except floating layers, motion only in answer to actions plus the three data moments.

## 6. Quality floor

Responsive from 375 px; visible focus on every interactive element; WCAG AA contrast in both themes (brand tokens are computed to pass); `MotionConfig reducedMotion="user"` at the root; Playwright MCP screenshots in light and dark at 1440 px and 390 px for every screen.
