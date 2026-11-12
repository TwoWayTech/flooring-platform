Review this branch against CLAUDE.md before it becomes a pull request. Extra focus, if any: $ARGUMENTS

This is a read-only self-review. Change nothing unless I ask after seeing the findings.

1. **Scope.** Run `git fetch origin`, then look at `git diff origin/main...HEAD`, `git status` and the uncommitted diff. List the changed files by area: web, api, db, shared, providers, docs, CI, tooling.
2. **Non-negotiable rules.** For each of the 15 rules in CLAUDE.md, check whether the diff touches it and whether it holds. Look in particular for:
   - fixture imports in components, or screens calling fetch instead of the ApiClient;
   - a tenant taken from a path, query or body, or a company database reached without TenantConnectionService;
   - endpoints without product, module, permission and data-scope guards, or permissions defined outside packages/shared;
   - sensitive fields (cost, margin, pay rate, credit limit) only hidden on screen and not stripped by the server;
   - JS floats or `toFixed` on money, quantities or rates, or display without formatNumber or `<Num>`; areas not in sq ft;
   - edits to posted invoices, bills or payments, stored ledger-derived statuses or balances, financial events without LedgerService, business writes without audit_log;
   - outside services called directly instead of through packages/providers; provider-specific SQL;
   - hard-coded tax, currency, unit or payroll rules;
   - feature switches out of sync between features.ts and docs/FEATURES.md, or a switched-off feature still reachable;
   - secrets, SSNs or bank account numbers anywhere, including tests, logs and docs; real brand names;
   - raw colors instead of tokens, missing dark theme, layouts that break at 375 px, missing focus styles, motion ignoring prefers-reduced-motion.
3. **Style.** Check for:
   - `any`, default exports and dead or commented-out code;
   - duplicated logic, and oversized files or functions;
   - an exported function, component, hook or type without a JSDoc;
   - a business rule without a comment pointing to its spec section.
4. **Tests.** Check that every behaviour change has tests at the right level: unit, API against Postgres, and Playwright. List missing ones. Ask whether lint, typecheck, test and test:api were run this session. If they were not, say so; do not claim they pass.
5. **Docs and process.** Check that:
   - the spec, api-contract, data-model, FEATURES, ADR and blueprint-delta are updated where needed;
   - the branch is named `feat/*` or `fix/*` and is not `main`;
   - commits are conventional and every commit is pushed;
   - today's session log exists, if this is the end of a session.
6. **Specialists.**
   - If schema or migrations changed, run the **schema-reviewer** subagent.
   - If any box in the PR template's "Needs a line-by-line human review" section applies, run the **security-reviewer** subagent.
   - Merge their findings into yours.
7. **Report.** For each finding, give a `file:line` reference, the rule it breaks and the fix, grouped as:
   - **Blocking:** breaks a non-negotiable rule, or is a bug or security issue;
   - **Should fix:** style, tests, docs;
   - **Notes.**

   Then list the PR-template checkboxes that apply. If there are no findings, say so plainly.
