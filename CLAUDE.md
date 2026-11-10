# Flooring Platform: demo build rules

## What this is
The clickable demo of a multi-company platform for US flooring businesses (Flooring Suite), plus an HR Suite served on its own host. Dummy data, no database, free hosting.
- Spec: docs/demo-spec.md (source of truth for the demo)
- Design: docs/design-brief.md
- Progress: docs/STATUS.md
- Full blueprint (PDF): docs/blueprint/blueprint.pdf; open it only for the section a task needs.

## Stack
pnpm + Turborepo | apps/web: Next.js App Router, TypeScript strict, Tailwind v4, shadcn/ui, Motion | packages/shared | packages/ui | Vitest + Playwright

## Commands
pnpm dev | pnpm build | pnpm lint | pnpm typecheck | pnpm test | pnpm test:e2e | pnpm fixtures

## Rules
1. Screens read and write data only through apiClient (demo implementation: DemoStore). Never import fixtures inside components.
2. Permissions come from packages/shared: effective = role permissions ∩ company ceiling ∩ enabled modules. Nobody grants more than they hold. Cost, margin, pay rate and credit limit need view_sensitive.
3. Money uses decimal.js. Numbers display only through formatNumber or <Num>. No toFixed in UI code.
4. Area is stored in sq ft and length in ft; convert with packages/shared/units.
5. Fixtures come from a fixed seed and must pass the reconciliation test (spec section 4).
6. Colors only through CSS variables and tokens. Both themes. Responsive from 375 px. Visible focus. Respect prefers-reduced-motion.
7. Follow docs/design-brief.md and its avoid-list; use the frontend-design skill for every UI task.
8. Prefer the libraries listed in the spec. If you add another, record why in docs/adr/.
9. Commit after every working screen with a conventional message, and tick docs/STATUS.md as you go.
10. Never write secrets; never read or edit .env files; use invented names, never real manufacturers' brands or logos.
11. Before stopping for any reason: commit, update STATUS.md with the exact next step, and write a log in docs/sessions/.
12. Push to GitHub after every commit (git push origin <current branch>). Never leave work only on this laptop.
13. Clean code: small focused files and functions, clear names, no dead or commented-out code, no duplicated logic. Prettier and ESLint must pass.
14. Comments: every exported function, component, hook and type gets a short JSDoc comment saying what it does and why. Business rules (tax, costing, units, permissions, ledger) get a comment explaining the rule and pointing to the spec section. No comments that only repeat the code.
15. Low-memory testing, always: test against a production build (pnpm build, then start the app), 2 Playwright workers (1 if memory is tight), e2e in chunks by project or folder, one server at a time, stopped after each run.