# Flooring Platform demo

A clickable demo of a multi-company platform for US flooring businesses (the Flooring Suite), plus an HR Suite on its own address. It runs on invented data with no database: each browser keeps its own copy, so nothing a visitor does reaches anyone else.

This file covers the demo only. The full README for the real product will live in `README.md` once that build starts.

- Flooring Suite: https://flooring-demo-twowaytech.vercel.app
- HR Suite: https://hr-demo-twowaytech.vercel.app

## Run it on your computer

You need Git, Node.js 22 or newer (24 recommended) and Google Chrome. pnpm comes through Corepack, which ships with Node.

```sh
git clone https://github.com/TwoWayTech/flooring-platform.git
cd flooring-platform
corepack enable
pnpm install
pnpm dev
```

Then open:

- Flooring Suite: http://localhost:3000/login
- HR Suite: http://localhost:3000/login?product=hr (locally a query parameter stands in for the HR address)

No environment file is needed. `DEMO_SESSION_SECRET` is optional locally; without it the session cookie is signed with a labelled non-secret key (docs/adr/0001-versions-and-stack.md).

## Signing in

Pick a company, then a persona (each sees the app as their role allows), then enter any six digits; the screen hints 123456. **Platform admin (you)** opens the admin pages. To start over, open the account menu (your initials, top right) and choose **Reset demo data**.

## Commands

Run these from the repository root.

| Command | What it does |
| --- | --- |
| `pnpm dev` | Starts the app at http://localhost:3000 |
| `pnpm build` | Production build |
| `pnpm lint` | ESLint and Prettier |
| `pnpm typecheck` | TypeScript in every package |
| `pnpm test` | Unit tests (Vitest) for the business rules, fixtures and feature register |
| `pnpm test:e2e` | Playwright tests; starts the dev server if it is not running |
| `pnpm fixtures` | Regenerates the demo data from its fixed seed |

### End-to-end tests against the live site

The suite has one Playwright project per product. Point each at its address and the dev server is not needed; remote runs retry twice and wait longer.

```sh
E2E_FLOORING_URL=https://flooring-demo-twowaytech.vercel.app \
E2E_HR_URL=https://hr-demo-twowaytech.vercel.app \
pnpm test:e2e
```

In PowerShell, set them first: `$env:E2E_FLOORING_URL="https://flooring-demo-twowaytech.vercel.app"; $env:E2E_HR_URL="https://hr-demo-twowaytech.vercel.app"; pnpm test:e2e`. HR Suite tests carry the `@hr` tag and always sign in to Harbor Staffing.

Locally Playwright uses your installed Chrome. On a machine without it, run `pnpm --filter web exec playwright install chromium` and set `CI=1`.

## Presenting

- docs/demo-script.md: a 25-minute click path, persona by persona.
- The presenter guide (presentation icon in the top bar) lists the same steps inside the app.
- docs/feedback-demo.md: the template for notes from each demo.

## Changing what the demo contains

Every feature has a key in docs/FEATURES.md and a switch in `packages/shared/src/features.ts`. Setting `enabled: false` hides it everywhere. To add, change or remove a feature, run `/feature-change` in Claude Code (`.claude/commands/feature-change.md`); it writes an ADR and logs the change in docs/blueprint-delta.md.

## Deploying

One Vercel project serves both addresses; the app picks the product from the hostname. From the repository root: `vercel deploy --prod`. Full steps and the current setup are in docs/deploy.md.

## Where things are

| Path | Contents |
| --- | --- |
| `apps/web` | The Next.js app: routes in `src/app`, screens in `src/features`, data access in `src/lib/api`, tests in `tests/e2e` |
| `packages/shared` | Business rules, types, permissions, the feature register, and the fixture generator with its data |
| `packages/ui` | Design tokens and shared components |
| `docs` | Spec, design brief, demo script, status, decisions (`adr`), session logs, feature register, deploy steps |

## If something goes wrong

- **A page says it could not load its data:** the presenter guide's Network control may be set to Offline. Set it to Normal, or reload.
- **Old or odd data:** account menu, Reset demo data.
- **Port 3000 is busy:** another dev server is running; stop it with Ctrl C in its terminal.
- **The computer slows down:** the dev server uses a lot of memory; stop it when you are done.
