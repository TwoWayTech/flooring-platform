# Session 2026-11-07: Phase 1 foundation, login

## What was done
- Finished the half-done monorepo scaffold: install repaired after an interrupted pnpm run, Prettier added (CLAUDE.md rule 13), lint runs ESLint and Prettier.
- Rules 12 to 14 were added to CLAUDE.md by the user mid-session; the scaffold was committed and pushed first, then the rules were applied.
- A second Claude session wrote `packages/shared` while this one installed. The user chose to keep this session; its files were reviewed and kept (catalog, roles, engine, money, units, numbers, documents, analytics, color, US pack, tests), then cleaned up: domain types split by area, magic rounding constants replaced, role matrix snapshot test added.
- Fixture generator (`pnpm fixtures`) and the reconciliation test (spec section 4).
- DemoStore, ApiClient contract, demo session routes, hostname proxy, docs/api-contract.md.
- docs/design-plan.md, design system (tokens, fonts, brand tokens from one color, floor pattern, roll gauge, Num), app shell, login.

## Decisions
- ADR 0002: shadcn primitives are vendored; file headers instead of per-export JSDoc. The CLI's stray `cn` npm package was removed.
- Login floor animation uses CSS keyframes (hundreds of planks); Motion is kept for interactions.
- Chart colors: the brand hue at a computed lightness and chroma, and a chart Oak, both validated with the dataviz palette checks for all three brands in both themes. Keystone in dark sits in the CVD 6 to 8 band, legal because the two series use different marks plus labels.
- "View as" scopes data to the first active user of the viewed role, so own-scope roles show real records.
- Date shift: fixtures are generated against 2026-11-04; DemoStore moves every date so that day becomes today, with weekly records moved by whole weeks.
- Playwright runs on the installed Chrome locally (`channel: "chrome"`); the bundled browser download stalled. CI uses the bundled browser.

## Commands run
- `pnpm lint`, `pnpm typecheck`: pass.
- `pnpm test`: 69 unit tests pass (permissions, numbers, units, money, tax, totals, overtime, colors, date shift, role matrix, reconciliation).
- `npx playwright test` in apps/web: 18 pass (login per persona on both hosts, shell, view as, company switch, phone drawer).

## Known issues
- The proxy matcher with a `$`-anchored extension pattern skipped every path except `/`; replaced with the documented shape.
- Turbopack needed a clean dev-server restart after adding `next/font`.

## Next
Phase 2 in STATUS order, starting with the Flooring dashboard.
