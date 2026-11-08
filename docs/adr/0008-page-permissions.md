# ADR 0008: Every page maps to a view permission

Date: 2026-11-08. Status: accepted.

## Context
Feature batch 2, item A3: a company Owner (or anyone with `settings.roles.manage`) decides, inside the platform ceiling, what each role sees and does. A role without a page's view permission must not see the menu item, and opening the address must show the standard "You don't have access to this page" state. Until now each page repeated its own check with its own message, and the shell only gated feature switches.

## Decision
- `apps/web/src/products/pages.ts` is the one page-permission map. Top-level pages take the permissions of their menu or settings item, so the menu and the address bar always agree; views and detail pages (`/sales?view=invoices`, `/inventory/rolls/*`, `/hr/time-off` and so on) have their own rule. The most specific matching rule wins, with the same patterns as feature screens (`pagePatternScore` in `packages/shared/src/features.ts`).
- `PageGate` (formerly `FeatureGate`) wraps every page in the shell: a switched-off feature shows "This feature is switched off", a missing permission shows "You don't have access to this page." `/` stays with the home page, which sends people to the first page they may open.
- Default roles keep a System badge, cannot be deleted, can be edited (except Owner) and have Reset to default (`resetRole`, which goes through the same no-escalation check as a save). Copy is now Duplicate.
- The effective access preview moved to `components/access-preview.tsx` and is shared by the super-admin's company access page and Settings: Security roles. It lists every page, every action and every sensitive field for a role or a person.

## Consequences
- New pages get a rule (or a menu item) in the same change; the e2e test "an Owner removes a page from the Sales role" covers the path from role to menu to address.
- Pages keep their own checks for tabs and buttons; the gate is the single place for the page itself.
