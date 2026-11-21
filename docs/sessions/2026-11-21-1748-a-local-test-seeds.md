# 2026-11-21 17:48, A: local test seeds (Harbor Staffing Co. and a platform admin)

Branch `feat/db-local-test-seeds`. ADR 0065.

## Goal
Close click-through #67 (blocker) and the owner's item 3: `pnpm db:seed` also seeds, for local testing only, the HR Suite company Harbor Staffing Co. and a dedicated platform admin.

## What changed
- `packages/db/src/seed/index.ts`: the Summit seed became the generic `seedDemoCompany`; `seedTestCompany` (Summit) is unchanged for its callers; new `seedLocalTestData` seeds Harbor (control rows, HR Suite only, branding, people with SEED_USER_PASSWORD, its own database and HR data) and the platform admin, and refuses a non-local control URL before connecting.
- `packages/db/src/seed/platform-admin.ts`: `platform.admin@platform.example`, "Platform Admin", `owner` in `platform_admins`, no membership, no MFA secret.
- `packages/db/src/local-url.ts`: `isLocalDatabaseUrl` and `redirectableUrl`, moved out of `testing.ts` (re-exported there) and used by `scripts/env.ts` too.
- `packages/db/scripts/seed.ts`: seeds Summit, then the local data.
- Tests: `packages/db/test/local-seed.int.test.ts`; `apps/web/tests/e2e-api/hr-suite.spec.ts` (Elena Brooks on the HR host, MFA enrolment); `HARBOR_OWNER_EMAIL` joins `SEEDED_EMAILS` so global-setup resets her.
- Docs: ADR 0065, blueprint-delta row, README and the playwright.api.config.ts header.

## Checks run
See the PR body for the exact results.

## Open questions
- The seeded platform admin cannot sign in yet: sign-in refuses a person with no company (`no_company`, apps/api/src/core/auth/company-pick.ts), and the web has no path from sign-in to `/admin` without a company. Admitting active platform admins with no company is an auth change for the owner to approve.
