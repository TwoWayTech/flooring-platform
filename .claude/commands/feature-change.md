Add, change or remove a feature of the demo. The change: $ARGUMENTS

1. Read CLAUDE.md, docs/FEATURES.md, `packages/shared/src/features.ts` and the code the change touches: the screens, permission keys, data and tests listed in the feature's row, and anything else that uses its key (search for the key).
2. Summarize the impact for me: which feature keys change and how, the screens, menus, permissions, data and tests affected, anything else that depends on it, and what stays as it is. Then ask me to confirm. Do not change anything before I confirm.
3. Write an ADR in docs/adr/ with the next number: the context (link the feedback file if there is one), the decision, and the consequences.
4. Update docs/FEATURES.md and `FEATURES` in `packages/shared/src/features.ts` together, in the same order; `packages/shared/test/features.test.ts` fails if they disagree.
5. To add a feature:
   - add its key to `FEATURES` (product, module, status, `enabled: true`, the routes it owns) and its row to docs/FEATURES.md;
   - add its permission keys to `packages/shared/src/permissions/catalog.ts`, and to the default roles in `packages/shared/src/permissions/roles.ts` where they belong;
   - add its data: types in `packages/shared/src/types`, the generator in `packages/shared/scripts/fixtures`, then `pnpm fixtures`, and the collection in the ApiClient contract and DemoStore (docs/api-contract.md);
   - add its screen: the route, the menu item with `features: ["<key>"]`, and a `featureOn` check wherever else it appears (tabs, buttons, command palette, presenter guide, attention checks);
   - add its tests: unit tests for its rules in `packages/shared/test`, a Playwright spec in `apps/web/tests/e2e` (tag HR Suite tests `@hr`, signing in to Harbor Staffing), and its screens in `apps/web/tests/e2e/screens.ts` for the layout, accessibility and console checks.
6. To change a feature, update its row, its key's entry and every place step 1 found, and keep its key.
7. To remove a feature, switch its key off first: set `enabled: false` and status `removed`, and update its row. Delete its code only when I ask, and then also its routes, permissions, data, tests and screen-list entries; keep the key out of reuse.
8. Log the change in docs/blueprint-delta.md: a new row at the top with the date, feature key, change, why, ADR and the blueprint section it departs from.
9. Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:e2e`, and fix anything that fails. Then commit with a conventional message, push (`git push origin <current branch>`), and update docs/STATUS.md.
