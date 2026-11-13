Build one feature of the real product, from spec to checked code. The feature: $ARGUMENTS

This is the build loop (blueprint p35: spec → plan → tests → code → run checks → summary). To switch a demo feature on or off, or add or remove a feature key, use `/feature-change` instead.

1. **Branch.** Work on a `feat/<area>-<name>` branch created from `main`, never on `main`. If you are on `main`, create the branch first.
2. **Read.** CLAUDE.md, the module spec in docs/product-spec/<module>.md, and only the sections of docs/data-model.md, docs/api-contract.md and docs/blueprint-delta.md that the feature touches. Open the blueprint PDF only for a section the spec points to. If no spec covers the feature, draft docs/specs/<module>-<feature>.md, show it to me and stop until I approve it.
3. **Plan.** Use plan mode when the change touches more than 3 files. The plan names the tables, endpoints, permission keys, screens and tests. Ask before adding a dependency, altering an existing table, or touching auth, tenancy or providers.
4. **Tests first.**
   - Write the unit tests for the rules yourself (Vitest, next to the package's other tests).
   - Hand the API tests (supertest against throwaway Postgres databases) and the Playwright specs to the **test-writer** subagent. Give it the spec path, the endpoints and the screens.
   - Run them and confirm they fail for the right reason.
5. **Code.** Make the tests pass. Hold to the non-negotiable rules in CLAUDE.md, especially:
   - screens use the ApiClient only, and a module moves to the API through API_METHODS;
   - company data only through TenantConnectionService, with the company from the verified session;
   - every endpoint checks product, module, permission and data scope (deny by default), using the engine in packages/shared;
   - the server strips cost, margin, pay rate and credit limit without view_sensitive;
   - decimal.js and decimal strings for money, quantities and rates; square feet as the area unit;
   - audit_log on every business write, and LedgerService for every financial event; posted documents are reversed, never edited;
   - rules come from company settings and the country pack, never hard-coded.
6. **Specialist reviews.**
   - If anything under packages/db schema or migrations changed, run the **schema-reviewer** subagent.
   - If the change touches login, sessions, MFA, tenancy, permissions, data scope, money, tax, the ledger or payroll, run the **security-reviewer** subagent.
   - Fix every blocking finding, and list the rest in the summary.
7. **Docs.** Update the spec if behaviour was decided while building, plus docs/api-contract.md, docs/data-model.md, and docs/FEATURES.md with `features.ts` when they are affected. Write an ADR in docs/adr/ for a new library or a lasting decision, and a row in docs/blueprint-delta.md for any departure from the blueprint.
8. **Checks.** Run `pnpm lint`, `pnpm typecheck` and `pnpm test`, plus `pnpm test:api` (start Postgres with `docker compose up -d`) and Playwright against a production build for the screens touched. Fix failures; do not skip or weaken tests.
9. **Summary.** Report:
   - what changed, by file group;
   - every check you ran, with its result;
   - the reviewers' findings and what you did about them;
   - what is left.

   Then suggest `/review` before the PR and `/handoff` before stopping. Commit with a conventional message and push with `git push origin <branch>` after each working step.
