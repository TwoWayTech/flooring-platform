# Status

- Current phase: not started
- Next step: run KICKOFF-PROMPT.md (Phase 0)
- Deployed URLs: none yet

## Checklist

### Phase 0: plan
- [ ] Versions checked with Context7; tasks below expanded

### Phase 1: foundation
- [ ] Monorepo: pnpm + Turborepo, apps/web, packages/shared, packages/ui
- [ ] packages/shared: keys, permission engine, formatNumber, units, money, US pack, unit tests
- [ ] Seeded fixtures generator and reconciliation test
- [ ] DemoStore, apiClient, demo route handlers, hostname proxy
- [ ] docs/design-plan.md reviewed against the brief
- [ ] Design system: tokens, fonts, themes, floor pattern, roll gauge
- [ ] App shell: sidebar, top bar, command palette, company switcher, view as role, theme toggle

### Phase 2: Tier 1 screens
- [ ] Login, personas, MFA
- [ ] Dashboard
- [ ] Inventory, roll detail, cut roll
- [ ] Quote builder, invoice, PDF
- [ ] Settings: users
- [ ] Settings: security roles
- [ ] Settings: branding
- [ ] Settings: localization and tax
- [ ] Settings: number format
- [ ] Settings: company profile and audit log
- [ ] Super-admin: companies and company access
- [ ] HR host: dashboard, employees, timesheets, PTO, own settings

### Phase 3: Tier 2 screens
- [ ] Customers and receivables
- [ ] Suppliers, purchase orders, payables
- [ ] Installation calendar and job card
- [ ] Reports hub
- [ ] Meetings

### Phase 4: Tier 3 polish
- [ ] Presenter guide panel
- [ ] Empty, loading and error states
- [ ] Accessibility and reduced-motion pass
- [ ] Visual QA in both themes at 1440 px and 390 px

### Phase 5: ship
- [ ] All tests green, production build passes
- [ ] docs/demo-script.md
- [ ] Deployed: Flooring and HR hosts

## Decisions
(see docs/adr/)

## Blockers
none
