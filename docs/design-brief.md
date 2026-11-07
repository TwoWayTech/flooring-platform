# Design brief: the demo's visual language

**Subject.** An operations platform for US flooring businesses: showrooms, wholesalers and installers. **Audience:** owners, sales reps, warehouse staff, installers, accountants and HR. **Primary job:** see the state of the business at a glance and act fast: quote a room, cut a roll, invoice a job, schedule a crew.

**Direction.** The calm precision of a modern operations tool (dense, keyboard-first, quiet), built from the materials of the trade: planks, weave, grout lines, dye-lot swatches. It must not read as a generic SaaS card kit. Spend boldness in one place, the floor pattern, and keep everything else disciplined.

## Tokens

### Color: light theme

| Name | Hex | Role |
| --- | --- | --- |
| Limestone | #EEF0EC | App background |
| Paper | #FAFBF9 | Panels, tables, inputs |
| Grout | #CDD3CD | Hairlines, dividers, input borders |
| Slate | #1F2B30 | Primary text, dark surfaces |
| Patina | #2E8B7E | Default brand accent; each company overrides it |
| Oak | #B8894D | Material accent: roll gauge, stock levels, inventory highlights |

States carry an icon and a word as well as color: Moss #3F8F55 (success), Amber #C98A1E (warning), Brick #C2453D (error).

### Color: dark theme

Background #152024, surface #1D2B31, raised #24343B, hairline #31444C, text #E6EBE8, muted text #9FB0AE. Accents brighten: Patina #4FB3A3, Oak #D3A867.

Only the brand accent changes per company: generate an OKLCH shade scale and an accessible text color from one brand color, and block colors that fail WCAG AA. Backgrounds and layout stay neutral.

### Type

- **Unbounded** (600, 700): page titles, key figures, the login wordmark. Use it sparingly, once per view region.
- **Instrument Sans** (400, 500, 600): everything else. Tabular numerals (`font-variant-numeric: tabular-nums`) for every number in tables and figures.
- Scale (minor third): 12, 13, 14 (base UI), 16, 19, 23, 28, 34, 41 px. Line height 1.45 for body text, 1.15 for display. Display letter-spacing −0.01em. Sentence case everywhere.
- Load both with `next/font/google`.

### Shape, depth, density

- Radius follows hierarchy: 4 px inputs and chips, 8 px panels, 14 px dialogs and drawers; tables stay square inside their panel.
- Depth comes from surface steps and hairlines, not shadows. One soft shadow only for floating layers (menus, ⌘K, drawers, toasts).
- Tables: 36 px rows (30 px compact option), sticky headers, numbers right-aligned. 8 px spacing grid. Content left-aligned.

## Layout

App shell:

```
+------------+------------------------------------------------------+
| [pattern]  |  Search or run a command   Ctrl K      bell  theme  AH |
| Summit     +------------------------------------------------------+
| Floor Co.  |  Page title (Unbounded)                [Primary action] |
|------------|                                                      |
| Dashboard  |  content                                             |
| Sales      |                                                      |
| Inventory  |                                                      |
| Purchasing |                                                      |
| Installing |                                                      |
| HR         |                                                      |
| Meetings   |                                                      |
| Reports    |                                                      |
|------------|                                                      |
| Settings   |                                                      |
| View as  v |                                                      |
+------------+------------------------------------------------------+
```

Dashboard: one large panel and supporting columns, not a grid of identical cards.

```
+--------------------------------------+---------------------+
| Revenue and gross margin, 12 months  | Needs attention     |
| key figures in one row above a large | 7 overdue invoices  |
| area + line chart                    | 3 rolls under 20 ft |
+------------------+-------------------+ 2 certificates     |
| Best sellers     | Slow movers       |   expiring          |
| ranked, with bars| days in stock     +---------------------+
|                  |                   | Today's jobs        |
|                  |                   | timeline by crew    |
+------------------+-------------------+---------------------+
```

Roll detail:

```
+-----------------------------------------------------------+
| Roll NL-4471   Harbor Twist, Driftwood   Dye lot 22B       |
| [ ROLL GAUGE: 150 ft original, 63 ft left, cut notches ]   |
| Width 12 ft   Remaining 63 ft (84 sq yd)   Cost $1.87/sq ft|
| [Cut roll]  [Move]  [Print label]                          |
+---------------------------------+-------------------------+
| Cut history (table)             | Remnants from this roll  |
+---------------------------------+-------------------------+
```

Quote builder:

```
+---------------------------------------------+---------------+
| Rooms: draw and resize rectangles           | Summary       |
| Living 14 x 18 ft = 252 sq ft               | Materials     |
| Hall 4 x 12 ft = 48 sq ft                   | Labor         |
+---------------------------------------------+ Tax (job site)|
| Lines: product, qty (sq yd or cartons),     | Deposit       |
| waste %, price, total                       | Total         |
|                                             | [Convert to   |
|                                             |  invoice]     |
+---------------------------------------------+---------------+
```

## The signature element: floor patterns

Each company has a laying pattern drawn as SVG planks in its brand accent at low contrast: Summit herringbone, Keystone running-bond plank, Harbor basketweave.

- On the login page the pattern lays itself plank by plank in one orchestrated sequence (about 1.2 s) behind the sign-in panel, then stays still. This is the only decorative motion in the product.
- The sidebar header carries a small static swatch of the pattern.
- With `prefers-reduced-motion`, the pattern appears complete, without animation.

The functional companion is the **roll gauge**: a side view of a roll showing original length, remaining length and cut notches. A mini version sits in inventory rows; a large one leads the roll page. When a user cuts a roll, the gauge animates the cut, because the motion shows what changed.

## Motion

Library: Motion (`motion/react`).

- Motion answers actions: drawers slide in on a spring (about 240 ms), dialogs scale and fade (160 ms), rows expand with height animation, toasts slide.
- Data moments, once each: key figures count up on the first dashboard load of a session; charts draw on first render; the roll gauge animates a cut.
- No fade-and-slide-up on every section, no lifting cards on hover. Hover is a background tint.
- `prefers-reduced-motion`: transitions become instant or opacity-only.

## Components and patterns

- ⌘K palette: navigation plus actions (New quote, Cut a roll, Invite user, Switch company, View as role, Toggle theme).
- Tables: TanStack; sticky header; column menu (sort, hide, more or fewer decimals); row click opens a side drawer; bulk select; CSV export.
- Status pills with an icon and a word: Draft, Sent, Accepted, Invoiced, Paid, Overdue.
- Forms: labels above fields, inline validation, units as field suffixes (sq ft, %, ft).
- Charts: brand accent for the first series, Oak for the second, neutrals after; tooltips use `<Num>`.
- When viewing as another role, a slim banner says so: "Viewing as Sales. Costs and margins are hidden."
- Empty states: one sentence and one action, e.g. "No purchase orders yet. Create a purchase order."

## Copy

Sentence case, plain verbs, active voice. An action keeps its name through the flow: "Convert to invoice" produces "Invoice INV-1042 created". Errors say what happened and how to fix it. No exclamation marks.

## Avoid

These read as generated, so do not use them:
- Cream background with a terracotta accent; near-black with one acid-green or vermilion accent.
- Identical rounded cards with the same grey shadow everywhere; gradient washes as decoration.
- Tracked-out ALL-CAPS labels above headings; meta strings joined with middle dots; arrows appended to button text; monospace for small labels.
- Fade-and-slide-up entrances on every section; hover transitions on every card.

## Inspiration (look, never copy)

- Linear: calm density, keyboard-first, the ⌘K palette.
- Stripe Dashboard: financial clarity, tables, number formatting.
- Vercel: restraint and typography.
- Interface, Shaw Contract, Bolon: how flooring brands use material texture, swatches and color stories. Borrow the cues (patterns, swatch chips, evocative color names), never their assets, names or logos.

## Quality floor

Responsive from 375 px, visible keyboard focus, WCAG AA contrast in both themes, reduced motion respected. Take Playwright MCP screenshots in light and dark at 1440 px and 390 px after each screen and fix what looks off before moving on.
