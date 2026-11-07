# ADR 0003: Automated accessibility checks, and focus fixes in vendored primitives

Date: 2026-11-07. Status: accepted.

## Context
Spec Tier 3 asks for an accessibility pass (keyboard, focus, contrast) and a reduced-motion pass on every screen, in both themes. Checking contrast and ARIA by eye across about thirty screens and two themes misses things, and the next change would undo the pass without anyone noticing.

## Decision
- Add `@axe-core/playwright` 4.14.0 (dev dependency of `apps/web`, pinned, released 2026-10-15). It is not in the spec's library list; it is the standard engine for WCAG checks in Playwright and ships nothing to the browser bundle.
- `tests/e2e/a11y.spec.ts` runs WCAG 2.1 A and AA rules on every Flooring, HR, admin and login screen in the light and dark themes, with the presenter guide open once per theme. It also checks the skip link, focus returning after a dialog, and reduced motion. The screen list lives in `tests/e2e/screens.ts`, shared with the phone layout test.
- Amends ADR 0002: two vendored primitives change behavior, not only styling.
  - `DialogContent` and `SheetContent` return focus to whatever opened them (`hooks/use-return-focus.ts`). Radix only does this for its own trigger, and most of our dialogs open from code.
  - Tab triggers use `text-muted-foreground` in both themes; the shadcn default (`foreground` at 60 %) measured 3.9:1 on the tab list.

## Findings fixed in the pass
- Brand ink on the soft brand tint was 4.46:1. `brandTokens` now requires ink to reach 4.5:1 on every neutral and on the soft tint, in both themes, with a unit test over several hues.
- Controls whose accessible name hid their visible text (command trigger, company switcher, account menu, job cards, room shapes) now take their name from that text.
- Page tabs render their view as a tab panel; the rolls filter, which filters a table rather than switching panels, is now a toggle-button group (`Segmented`).
- Tables that scroll sideways sit in a named, focusable `ScrollRegion`.
- `autoFocus` inside dialogs was removed: Radix already focuses the first field, and `autoFocus` hid the opener from the return-focus hook.
- A skip link leads to `#main`, and under reduced motion every CSS animation and transition finishes at once (Motion already follows `MotionConfig reducedMotion="user"`).
