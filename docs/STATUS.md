# Status

- Current phase: Phase 4 (Tier 3 polish)
- Next step: Phase 4, visual QA: screenshot every screen in tests/e2e/screens.ts in light and dark at 1440 px and 390 px, fix what looks off (alignment, truncation, empty space, contrast of decorative marks), then run the Phase 4 checks and write the session log.
- Deployed URLs: none yet
- Last session log: docs/sessions/2026-11-07-2015-phase3-tier2.md

## Checklist

### Phase 0: plan
- [x] Versions checked with Context7; tasks below expanded (ADR 0001)

### Phase 1: foundation
- [x] Monorepo: pnpm + Turborepo, apps/web, packages/shared, packages/ui; lint, typecheck, test scripts wired
- [x] packages/shared: keys, permission engine, formatNumber, units, money, US pack, unit tests
  - permission keys `module.resource.action`, modules, products, default roles + data scope
  - effectivePermissions, canGrant, canAssignRole, dataScope, sensitive fields
  - formatNumber + number kinds/defaults; units (sq ft, sq yd, cartons, roll area); money (decimal.js)
  - US pack: 50 states + DC, sales tax example rules (CO, PA, FL, NJ, MD, TX), overtime (federal + CA daily)
  - quote/invoice totals calculator (lines, waste, labor tax by job-site state)
- [x] Seeded fixtures generator (`pnpm fixtures`) and reconciliation test
- [x] DemoStore, apiClient, demo route handlers (login, logout, context), hostname proxy; docs/api-contract.md
- [x] docs/design-plan.md reviewed against the brief
- [x] Design system: tokens, fonts, themes, brand scale from one color, floor pattern, roll gauge, Num
- [x] App shell: sidebar, top bar, command palette, company switcher, view as role, theme toggle, notifications

### Phase 2: Tier 1 screens
- [x] Login, personas, MFA
- [x] Dashboard
- [x] Inventory, roll detail, cut roll
- [x] Quote builder, invoice, PDF
- [x] Settings: users
- [x] Settings: security roles
- [x] Settings: branding
- [x] Settings: localization and tax
- [x] Settings: number format
- [x] Settings: company profile and audit log
- [x] Super-admin: companies and company access
- [x] HR host: dashboard, employees, timesheets, PTO, own settings

### Phase 3: Tier 2 screens
- [x] Customers and receivables
- [x] Suppliers, purchase orders, payables
- [x] Installation calendar and job card
- [x] Reports hub
- [x] Meetings

### Phase 4: Tier 3 polish
- [x] Presenter guide panel
- [x] Empty, loading and error states
- [x] Accessibility and reduced-motion pass
- [ ] Visual QA in both themes at 1440 px and 390 px

### Phase 5: ship
- [ ] All tests green, production build passes
- [ ] docs/demo-script.md
- [ ] Deployed: Flooring and HR hosts

## Decisions
(see docs/adr/)

## Blockers
none
