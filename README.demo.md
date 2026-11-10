# Flooring Platform demo

A clickable demo of a multi-company platform for US flooring businesses (the Flooring Suite), plus an HR Suite on its own address. It runs on invented data with no database: each browser keeps its own copy, so nothing a visitor does reaches anyone else.

This file covers the demo only. The full README for the real product will live in `README.md` once that build starts.

- Flooring Suite: https://flooring-demo-twowaytech.vercel.app
- HR Suite: https://hr-demo-twowaytech.vercel.app

## What the demo shows

The original demo plus feature batch 2 (docs/specs/feature-batch-02.md): warehouses and showrooms with transfers; table filters and saved views; company admins controlling roles and pages; quotes in Draft and Pending; invoices whose status comes from payments, with proof files, a two-person check, voids, write-offs, credits and refunds; stock reserved by invoices and cut after payment, with adjustments and approval; purchase orders, receipts, matched supplier bills and supplier payments; a dashboard by period with commissions and a sales team view; a meetings calendar with drag and resize; and a data import wizard with a database connection planner. 

Feature batch 3 (docs/specs/feature-batch-03.md) followed client feedback: square feet everywhere with cartons beside it; quotes that start from a warehouse; a supplier directory with sales reps; contracts with progress billing, retainage, change orders and compliance, in place of Installation; expenses per location with a shared-cost rule and one Business report from revenue to profit; meetings with guests by email, invitations with calendar files and an Outbox that simulates every email; a real HR area with timesheets, time off, gross pay by workweek and commission plans; and an employee portal in both products. Stock adjustments, Installation and four reports are switched off, with their code kept.

docs/FEATURES.md lists every feature with its screens and tests. docs/product-spec/ describes each module as built, docs/data-model.md maps the demo's records to the blueprint's tables, and docs/api-contract.md lists every call.

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
| `pnpm test:e2e` | Playwright tests against a production build: run `pnpm build` first; it starts `pnpm start` if no server is running. Two workers by default (`E2E_WORKERS` to change) |
| `pnpm fixtures` | Regenerates the demo data from its fixed seed |

### End-to-end tests on a computer with little memory

Build once, then run the suite in parts by spec file, keeping one server: for example `pnpm --filter web exec playwright test tests/e2e/a11y.spec.ts tests/e2e/import.spec.ts`, then the next group. `--grep @flow` runs the named end-to-end flows of feature batches 2 and 3. Stop the server when you are done.

### End-to-end tests against the live site

The suite has one Playwright project per product. Point each at its address and the dev server is not needed; remote runs retry twice and wait longer.

```sh
E2E_FLOORING_URL=https://flooring-demo-twowaytech.vercel.app \
E2E_HR_URL=https://hr-demo-twowaytech.vercel.app \
pnpm test:e2e
```

In PowerShell, set them first: `$env:E2E_FLOORING_URL="https://flooring-demo-twowaytech.vercel.app"; $env:E2E_HR_URL="https://hr-demo-twowaytech.vercel.app"; pnpm test:e2e`. HR Suite tests carry the `@hr` tag and always sign in to Harbor Staffing.

Locally Playwright uses your installed Chrome. On a machine without it, run `pnpm --filter web exec playwright install chromium` and set `CI=1`.

## Address suggestions

Address fields suggest full addresses as you type ("123 Main", "Sacramento, Calif"). Without any setup the demo uses its own offline list: about 140 US cities and 300 seeded addresses, plus addresses built from the house number and street you type. Picking one fills street, city, state, ZIP, county (which picks the county tax rate) and coordinates; the fields stay editable for entering an address by hand.

To use Google instead, set `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and rebuild. The app then calls Places API (New) Autocomplete with a session token per address, closed by one Place Details call that asks only for the formatted address, address components and location, United States only.

1. In the Google Cloud console, create or pick a project and enable **Places API (New)**.
2. Under APIs and services, Credentials, create an API key.
3. Restrict it: application restriction **Websites**, with `https://flooring-demo-twowaytech.vercel.app/*` and `https://hr-demo-twowaytech.vercel.app/*` (add `http://localhost:3000/*` for local use); API restriction **Places API (New)** only.
4. Add it to the Vercel project as `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (Production and Preview) with `vercel env add`, then redeploy. Locally, put it in your own environment, never in the repository.

The key is visible to browsers by design (the website restriction is what protects it). Remove the variable and redeploy to go back to the offline list.

## Data import

Settings, **Data import** (Owners, or roles with Manage data import), and Platform admin, a company, **Data import**: customers, customer addresses, suppliers, products, rolls and stock, open customer invoices, open supplier bills, employees and timesheets (by the company's modules). Each kind has a CSV and an Excel template. Files are read in the browser by a Web Worker (Papa Parse and SheetJS), up to 10 MB and 2,000 rows in the demo; nothing is uploaded anywhere. Rows match on external ID, SKU or email, so importing the same file again updates instead of adding twice. Every import can be undone from its history unless its records were changed or used since. **Connect a database** shows the plan for a live connection with a simulated test; docs/specs/data-integration.md is the design for the real product.

## Presenting

- docs/demo-script.md: a 40-minute click path, persona by persona.
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
| `docs` | Spec, design brief, demo script, status, decisions (`adr`), session logs, feature register, deploy steps, and the backbone for the real build (`product-spec`, `data-model.md`, `api-contract.md`) |

## If something goes wrong

- **A page says it could not load its data:** the presenter guide's Network control may be set to Offline. Set it to Normal, or reload.
- **Old or odd data:** account menu, Reset demo data.
- **Port 3000 is busy:** another dev server is running; stop it with Ctrl C in its terminal.
- **The computer slows down:** the dev server uses a lot of memory; stop it when you are done.
