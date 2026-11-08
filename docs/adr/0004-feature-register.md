# ADR 0004: Feature register and feature switches

Date: 2026-11-08. Status: accepted.

## Context
After the demo, features will be added, changed, deferred or dropped based on client feedback. We need one list of what the demo contains, and a safe way to take a feature out without deleting code until a removal is confirmed.

## Decision
- `docs/FEATURES.md` is the register: one row per feature with key, product, module, status, screens, permission keys, data, tests and notes.
- `packages/shared/src/features.ts` holds the same keys as code (`FEATURES`), each with an `enabled` switch, its status and the routes it owns. `featureOn(key)` reads a switch; `featureForPath(product, href)` finds the feature that owns a route or link.
- The app checks the switches at every place a feature appears: menu items (`features` on each `MenuItem`), the route gate in the app shell (`PageGate`, which since feature batch 2 also checks the page permission, ADR 0008), page tabs, buttons such as New quote and Convert to invoice, command-palette actions, presenter-guide steps, attention checks, the shell controls, sign-in and the platform admin layout and login route. A switched-off feature leaves no menu item, tab, button or step, and its addresses show "This feature is switched off".
- Product is `flooring`, `hr` or `both`. `both` marks platform features every product has (Settings, sign-in, the app shell, Meetings); listing them twice would double the switches for one piece of code.
- A removed feature is always off, whatever its switch says, and its key is never reused.
- `packages/shared/test/features.test.ts` fails when the register and the code disagree on keys, order, product, module, status or screens, or when the register names a permission key, collection or test file that does not exist.
- Changes go through `.claude/commands/feature-change.md`, which also logs them in `docs/blueprint-delta.md`.

## Consequences
- Turning a feature off is a one-line change and a redeploy, and is reversible.
- Feature switches are global for the whole platform. Per-company control stays with modules, the permission ceiling and roles, which the switches sit on top of.
- Every new screen needs a register row and a key before it ships, which the test enforces.
