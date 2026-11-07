# Demo spec: Flooring Suite + HR Suite (clickable demo)

The demo shows a client the whole product in one sitting: two flooring companies and one HR-only company, every key screen, dummy data that adds up, both themes, and the permission model working live. There is no database and no backend server; it runs on free hosting. It is built on the real product's foundation (the full blueprint is `docs/blueprint/blueprint.pdf`), so the code carries over to the real build.

Open the blueprint PDF only when this spec points to a section; this file is the demo's source of truth.

## 1. Architecture

| Part | Choice |
| --- | --- |
| Repo | pnpm workspaces + Turborepo: `apps/web`, `packages/shared`, `packages/ui` |
| Web | Next.js (latest stable, App Router), TypeScript strict, Tailwind CSS v4, shadcn/ui |
| Motion | Motion (`motion/react`) |
| Charts | shadcn chart components (Recharts) |
| Tables | TanStack Table |
| Command palette | shadcn Command (cmdk) |
| Theme | next-themes (light, dark, system) |
| Forms | React Hook Form + Zod |
| Money | decimal.js; never JS floats for money math |
| Dates | date-fns |
| Fake data | @faker-js/faker with a fixed seed; a generator script writes JSON fixtures |
| PDFs | @react-pdf/renderer, generated in the browser |
| Toasts / icons | sonner / lucide-react |
| Tests | Vitest (packages/shared), Playwright (tests/e2e) |

Data flow:
- Every screen reads and writes through an `apiClient` interface (`apps/web/src/lib/api`). The demo implementation is `DemoStore`: generated fixtures plus a per-company localStorage overlay for changes the presenter makes. A "Reset demo" action restores the fixtures. `NEXT_PUBLIC_DATA_SOURCE=demo` selects it. Document every call in `docs/api-contract.md` so the real API can replace it later without touching screens.
- Only three route handlers: `POST /api/demo/login` (signed httpOnly cookie with company, product, role, user), `POST /api/demo/logout`, `GET /api/demo/context`.
- Product by hostname: `proxy.ts` (or `middleware.ts` if the installed Next.js version still uses it; check with Context7). Hosts starting `hr-demo` and `?product=hr` on localhost load the HR Suite; everything else loads the Flooring Suite. Super-admin lives at `/admin`.
- Product config: `apps/web/src/products/flooring.ts` and `hr.ts` declare menus, modules and default branding.

Shared rules (`packages/shared`), all unit-tested:
- Product, module and permission keys (`module.resource.action`), default roles with data scope (blueprint: "Default roles").
- `effectivePermissions(userRoles, ceiling, modules)` = union of role permissions ∩ company ceiling ∩ enabled modules.
- `canGrant(granter, roleOrPermission)`: nobody grants what they do not hold. `dataScope`: own, branch, all (widest of the user's roles).
- Sensitive fields (product cost, margin, pay rate, credit limit) need the matching `*.view_sensitive` permission.
- `formatNumber(value, kind, settings)` on `Intl.NumberFormat`, plus a `<Num kind value />` component; kinds and defaults from blueprint "Number display".
- Units: area stored in sq ft (sq yd = sq ft ÷ 9; cartons from coverage per carton); roll length in ft; roll area = width ft × length ft.
- US country pack: 50 states + DC, imperial units, USD, sales tax model, federal overtime (40 h/week) with a California daily-overtime example.

## 2. Login and personas

The login page is branded per product host and company. The presenter picks a company, then a persona card (Owner, Manager, Sales, Warehouse, Installer, Accountant, HR; HR host: Owner, HR manager, Employee), then passes a simulated MFA step (any 6 digits; a hint shows 123456). A separate "Platform admin (you)" card opens `/admin`. Signing out returns to the login page.

## 3. Demo companies

| Company | City | Product and modules | Brand color | Floor pattern | Logo |
| --- | --- | --- | --- | --- | --- |
| Summit Floor Co. | Denver, CO | Flooring Suite: Core, Retail, Installation, HR, Meetings | Patina teal | Herringbone | Generated "SF" monogram |
| Keystone Flooring Supply | Harrisburg, PA | Flooring Suite: Core, Wholesale, HR, Meetings | Deep green | Running-bond plank | Generated "KF" monogram |
| Harbor Staffing Co. | Tampa, FL | HR Suite only: HR, Meetings | Ocean blue | Basketweave | Generated "HS" monogram |

Use invented brand and company names everywhere. Never use real manufacturers' names or logos.

## 4. Dummy data (seeded, must reconcile)

- Catalog, 120 products: carpet broadloom rolls (12 ft and 15 ft wide, priced per sq yd), carpet tile, LVP/LVT (cartons, e.g. 23.64 sq ft per carton), laminate, engineered and solid hardwood, porcelain tile, pad and underlayment, adhesives and trims, services (installation per sq ft, removal, stairs per step, furniture moving). Invented brands such as Northline Mills, Ridgeway Hardwood, Coastal Plank Co., Stonecrest Tile, Loomcraft, CushionPro. Attributes: fiber (nylon, polyester, wool, triexta), construction (cut pile, loop, cut-loop), face weight (oz), color name, collection, width, wear layer for LVP, species for wood.
- Rolls, 60: roll number, dye lot, width, original length 100 to 150 ft, remaining length, cost per sq ft, location (warehouse and bin), 15 remnants.
- Customers, 80: 50 homeowners, 18 dealers, 12 contractors; payment terms; credit limits; 6 tax-exempt with resale certificates (2 expiring within 30 days).
- Suppliers, 15, with 12 months of purchase orders, receipts, bills and payments; some bills open.
- Sales, 12 months: about 300 quotes, 220 invoices and their payments; spring and fall peaks; about 12% of invoices overdue; about 3% returns.
- Installation: 4 crews and 3 subcontractors (1099); 40 jobs (past, today, upcoming) with materials, labor, margin, placeholder photos and sign-off.
- HR: Summit 18 employees, Keystone 12, Harbor 30 (W-2 and 1099 mix); 8 weeks of timesheets including overtime cases; PTO requests; sales commissions.
- Meetings: 25 across companies, some recurring, with reminders.
- Monthly P&L figures are computed from the documents (revenue, cost of goods, gross margin, expenses), never typed by hand.
- Reconciliation checks run in a unit test: invoice total = sum of lines + tax; payments never exceed totals; receivables aging sums to open invoices; inventory valuation = rolls remaining × cost + cartons × average cost.
- Sales tax: the US pack plus example rules for CO, PA, FL, NJ, MD and TX, each labelled "Example: confirm with your accountant". Installation labor taxability differs by job-site state (blueprint: "Sales tax engine").

## 5. Screens, in build order

### Tier 1 (must have)

| Screen | Must show | Acceptance |
| --- | --- | --- |
| Login | Branding per host and company, persona cards, MFA step | Each persona lands on its allowed home; HR host shows HR branding |
| App shell | Sidebar from product config and permissions, top bar, ⌘K palette (navigation and actions), company switcher, "View as role" switcher with a banner, theme toggle, notifications | Switching company changes logo, name, colors and pattern; HR host shows only HR menus |
| Dashboard (Flooring) | Revenue and gross margin over 12 months, key figures, "Needs attention" list (overdue invoices, low rolls, expiring certificates, today's jobs), best and slow sellers, today's jobs | Figures match the fixtures; Sales role sees no margin |
| Inventory and roll detail | Filterable product and roll list with mini roll gauges; roll page with large roll gauge, dye lot, original vs remaining length, cut history, remnants, location, cost (permission) | "Cut roll" dialog: enter length, gauge animates the cut, remaining updates, leftover under 12 ft becomes a remnant |
| Quote builder → invoice | Room canvas (draw and resize rectangles, auto sq ft), product lines in sq yd or cartons with waste %, labor lines, tax by job-site state from settings, deposit, convert to invoice, invoice view, PDF download | Changing the job-site state changes labor tax; totals use decimal math; PDF matches the screen |
| Settings: Users | List (status, roles, branch, MFA, last login, seats used vs limit), invite, disable, reset MFA | Seat limit enforced |
| Settings: Security roles | Role list, create or copy, permission matrix by module → resource → action, data scope, greyed "Not included in your plan" items, locked Owner, simulated step-up MFA on save | Granting a permission you do not hold is blocked; last Owner cannot be removed |
| Settings: Branding | Logo upload (stored in DemoStore), brand color with live preview and contrast check, default theme, reset | Changes apply instantly across the shell |
| Settings: Localization and tax | Tabs Region, Currency, Sales tax, Payroll rules, Documents (blueprint: "Localization, currency and tax settings") | Rules feed the quote builder |
| Settings: Number format | Decimals per number kind, negative style, compact numbers; per-column "More decimals / Fewer decimals" | Changing money decimals from 2 to 0 changes display, not totals; hover shows the full value |
| Settings: Company profile and Audit log | Profile form; audit list of role, user, ceiling and settings changes | Every change made in the demo appears in the audit log |
| Super-admin | Companies list (status, plan, products); company access page: products, modules, permission ceiling toggles, user and branch limits, read-only roles and users, effective-access preview for any role or user | Removing a permission from the ceiling hides it everywhere for that company at once |
| HR host | HR dashboard, employees (W-2 and 1099, pay rate only with HR permission), weekly timesheet grid with overtime flags, PTO requests and balances, its own Users, Roles and Settings | Harbor Staffing never sees flooring menus or permissions |

### Tier 2

| Screen | Must show |
| --- | --- |
| Customers and receivables | Homeowners, dealers, contractors; customer drawer; statement; aging buckets (current, 30, 60, 90+) |
| Suppliers and purchasing | Supplier list; purchase order → receive → bill; amount owed per supplier; payables aging |
| Installation | Week calendar by crew and subcontractor; job card with materials, labor, margin, photos, sign-off |
| Reports hub | P&L, sales by category, sales tax by jurisdiction, inventory valuation; date, branch and category filters; CSV export (real) and PDF export |
| Meetings | Calendar, attendees (staff, customers, suppliers), recurring meetings, reminders |

### Tier 3 (polish)

- Presenter guide: a small panel listing the demo steps, each linking to its screen.
- Empty, loading and error states on every screen.
- Accessibility pass (keyboard, focus, contrast) and reduced-motion pass.
- Visual QA in both themes at 1440 px and 390 px.

## 6. Definition of done

- Tier 1 and Tier 2 screens work in both themes from 375 px up, with no console errors.
- Playwright tests: login per persona; "View as Sales" hides costs and margins; privilege escalation blocked; ceiling change hides a permission; decimals change display but not totals; job-site state changes labor tax; roll cut updates remaining length and creates a remnant; quote → invoice → PDF; HR host shows only HR menus.
- Production build passes; deployed to Vercel Hobby with two hostnames (`flooring-demo` and `hr-demo`, both `.vercel.app`) on one project, or Netlify Free as the fallback.
- `docs/demo-script.md`: a 20 to 30 minute click path for presenting, persona by persona.
