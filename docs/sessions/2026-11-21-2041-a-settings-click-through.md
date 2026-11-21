# 2026-11-21 20:41 · A · settings click-through fixes

Branch `fix/settings-click-through`. Closes click-through #51, #52, #53 (layout part), #56, #58, #68, #69, #70.

## Goal
Close the settings, import, audit and demo-control findings of the api-mode click-through.

## What changed
- **#51** `packages/shared/src/customer-rules.ts`: `zipProblem`, `PAYMENT_TERMS` and `CUSTOMER_FIELD_MESSAGES`, used by the import (a new `zip` field type, read with the cell so it is flagged beside other bad cells; `unknownChoice` for terms), the address dialog, the profile dialog and the API's `TERMS`. Net 45 is an allowed term (spec import.md, sales.md), so it stays valid.
- **#52** `fixRowsTable`: the rows left out, under the file's own headers with a Problems column; the done step offers "Download rows to fix" beside the error report.
- **#53** Security roles: the settings menu is a row above the page below 1400 px (`SettingsFrame`), the roles list stacks above the editor, and the permission grid scrolls in its own box with sticky headers and resource column.
- **#56** `lib/leave-guard.ts` + `LeaveGuardDialog` in the shell: SettingsForm marks itself dirty; in-app links and palette navigation ask first, tab close or reload gets the browser prompt.
- **#58** `auditChanges` (shared) and `AuditChangeList`: "Label: old → new" lines, ids named from `AuditEntry.names` (the API resolves locations, branches, customers, suppliers, products, roles and users), numbers via `<Num>`, a Show raw switch, raw columns hidden at first. A new customer logs name, type, email, phone and terms; a roll cut logs "Cut roll NM-x for INV-x"; change order decisions name CO-n (API and demo).
- **#68** `MARGIN_REVEALING_FIELDS` + `@MarginRevealingFields()` on the invoices and sales controllers: `unitCost` and `cost` are stripped without margin sight (`seesMargin`).
- **#69** `featureInBuild` hides the presenter guide, network simulation and Reset demo data in api mode; Connect a database is `demoOnly`; the api-mode product cookie is `product_choice`, and plain /login in api mode decides by the host only.
- **#70** `accountRoleLine` shows a title equal to a role once.

## Checks run
- `pnpm typecheck`, `pnpm lint`: pass.
- Unit: shared 1271, web 587 (coverage and page-gate snapshots regenerated), api 130: pass.
- Integration (one by one): invoices 16, sensitive-fields + stock-issue 17, contracts, users, sales 11, imports 35: pass.
- Playwright not run locally (shared laptop); new `tests/e2e-api/demo-controls.spec.ts` typechecks and lints.

## Open questions
- Browser Back with unsaved changes is not intercepted (App Router gives no hook); links, the palette, reload and close are.
- Contract billing answers (contracts controller) are not marked margin-revealing; contract invoice costs already need the contracts key.
