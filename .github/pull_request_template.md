## What and why

<!-- One or two sentences. Link the spec (docs/specs/ or docs/product-spec/) this implements. -->

## Session logs

<!-- Every docs/sessions/ file written for this branch. -->
- docs/sessions/

## Checks run

- [ ] `pnpm lint` and `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm test:api` (local PostgreSQL)
- [ ] Playwright for the screens touched, against a production build
- [ ] Moved from draft to ready, so CI runs verify and the full browser suite

## Screenshots

<!-- Light and dark, 1440 px and 390 px, for any screen that changed. -->

## Needs a line-by-line human review (blueprint "Security")

- [ ] Touches login, sessions or MFA
- [ ] Touches tenancy (company databases, TenantConnectionService, guards)
- [ ] Touches permissions or data scope
- [ ] Touches money, tax, the ledger or payroll
- [ ] Adds a dependency, changes an existing table, or changes a provider

If any box above is ticked, the other person reviews every line, and the security-reviewer pass is linked here.
