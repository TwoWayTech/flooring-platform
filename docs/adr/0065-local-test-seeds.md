# ADR 0065: Local test seeds: Harbor Staffing Co. and a platform admin

- **Status:** accepted, 2026-11-21, on branch `feat/db-local-test-seeds`. Closes click-through finding #67 (blocker) and the owner's item 3 of 2026-11-21. Session log docs/sessions/2026-11-21-1748-a-local-test-seeds.md.
- **Context:**
  - `pnpm db:seed` seeded only Summit Floor Co. (ADR 0029 gave its people SEED_USER_PASSWORD). Section 5 of docs/demo-script.md, the HR Suite with **Harbor Staffing Co.** and **Elena Brooks, Owner**, could not run in api mode: no HR Suite company existed, and a Summit person on the HR host got "Your company does not have this product." (docs/click-through-notes.md #67).
  - Nobody was a platform admin after a seed. The api-mode specs make Summit's Owner one for a while (`setPlatformAdmin`) and remove the row after, so a person clicking through had no console to open.
  - The demo fixtures already hold Harbor (`packages/shared/fixtures/harbor.json`): 8 people with Owner, HR and Employee roles, 30 employees, timesheets, time off, 7 pay periods, contractor payments, meetings and the company's holidays (in Settings → HR), with its own branding.

## Decision

1. **`pnpm db:seed` seeds Summit, then the local-only data.** `seedTestCompany` (Summit) is unchanged and still the only seed the API test harness and the standing helpers use. A new `seedLocalTestData` (packages/db/src/seed/index.ts) seeds:
   - **Harbor Staffing Co.** exactly as Summit is seeded, from the same generic code (`seedDemoCompany`): its control rows (tenant, plan "HR Standard", the **HR Suite product only**, its ceiling, its branding "HS" #1F6FA8, its 8 people as Better Auth users and members with their role keys, a credential with SEED_USER_PASSWORD), **its own company database through the provisioner** (`harbor` beside `summit`), and that database's rows: roles, profiles, settings (holidays included), employees, timesheets, time off, pay periods, bonuses, contractor payments and meetings. The Flooring Suite tables stay empty, as the fixtures have them.
   - **A platform admin**, an invented account of the platform team: `platform.admin@platform.example`, "Platform Admin", an active `owner` row in `platform_admins`, a credential with SEED_USER_PASSWORD, **no company membership and no MFA secret**. Platform admins must use MFA (blueprint p27; `MfaPolicy`), so the account enrols at its first sign-in like any MFA role.
2. **Local only.** `seedLocalTestData` refuses, before it connects anywhere, a control database URL that is not on this machine: the host must be `localhost` or `127.0.0.1` and the URL must not be redirectable (`redirectableUrl`: only `postgres:`/`postgresql:`, no fragment, no query option but `sslmode`). The check moved from `testing.ts` to `packages/db/src/local-url.ts` (`isLocalDatabaseUrl`) so the seed, the test helpers and `scripts/env.ts` (the public local encryption key) share one rule. On a remote database the script seeds Summit, then stops with the error "Harbor Staffing Co. and the platform admin are seeded only into a control database on this machine (localhost or 127.0.0.1); CONTROL_DATABASE_URL is not one." and exits 1.
3. **Idempotent.** Stable UUID v5 ids from `seedId` (as for Summit), every insert `on conflict do nothing`: a second run changes nothing, and nothing the person changed since is overwritten. CI already seeds twice.
4. **`pnpm db:migrate`** already migrates every company in `tenant_databases`; Harbor's database is one of them. No code change.
5. **No new variable.** SEED_USER_PASSWORD, CONTROL_DATABASE_URL and TENANT_DB_ADMIN_URL as before; docs/environment.md is unchanged.

## Known gap (question for the owner)

- **The seeded platform admin cannot sign in yet.** Sign-in opens a company: a person with no membership is refused with `no_company` ("This account is not part of any company yet.", `pickCompany` in apps/api/src/core/auth/company-pick.ts, whose comment says "platform admins sign in on their own host, later"), and the web's sign-in has no path to `/admin` for a session without a company. Letting an active platform admin with no company in is an auth change (API session with no company, then the web sending such a session to `/admin`), which this task was not cleared to make. The account, its password and its `platform_admins` row are seeded so that change only has to admit it. Until then, a click-through of the console keeps using `setPlatformAdmin` on a company person, as the api-mode specs do.

## Consequences

- The platform's company list now shows two companies after a seed (Summit and Harbor). No test counted the companies; the api-mode specs find Summit's row by name.
- The fresh-company helpers already refuse Harbor's slug and its people's emails (`DEMO_COMPANIES` in testing.ts).
- `apps/web/tests/e2e-api/hr-suite.spec.ts` signs Elena Brooks in on the HR host (`/login?product=hr`), enrols her authenticator app and opens the HR Suite home with Harbor's name; global-setup resets her sign-in state with the other seeded accounts.
- **Alternatives:** a separate `pnpm db:seed:local` script (one more command to forget; the click-through ran `pnpm db:seed`); a `SEED_LOCAL` variable (a switch that could be left on for a remote database); making a Summit person the platform admin (the owner asked for a dedicated account, and a company person's MFA and roles would mix with the console's).
