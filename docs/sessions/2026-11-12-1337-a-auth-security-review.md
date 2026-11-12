# Session 2026-11-12 13:37, Person A: security review of P8 part 1

- **Branch:** `feat/auth-better-auth`
- **PR:** [#2](https://github.com/TwoWayTech/flooring-platform/pull/2), now marked ready. All checks are green; not merged.
- **Previous log:** docs/sessions/2026-11-12-1244-a-auth-better-auth.md

## Goal
Run `/security-review` on the P8 part 1 branch and fix every real finding. Commit and push the fix, mark PR #2 ready, and watch CI until it is green. Do not merge. Delete the `scratch-e2e` temp folder from the earlier browser test.

## Prompt used
> /security-review, then: Fix every real finding on feat/auth-better-auth, commit and push. Also find and delete the scratch-e2e temp folder from your earlier browser test (it holds a throwaway password) and tell me the path you deleted. Then gh pr ready 2 and gh pr checks 2 --watch. Tell me when all checks are green. Don't merge. Then /handoff.

## Security review result
One sub-agent reviewed the diff. A second, independent sub-agent verified each candidate.

- **Confirmed (MEDIUM, confidence 8 of 10): the idle timeout could be bypassed.**
  - The company idle timeout was only checked in `SessionService.verify`, on guarded Nest routes. Better Auth's `/api/auth/*` endpoints sit outside Nest.
  - `POST /api/auth/organization/set-active` accepted a session that had already gone idle. It updated the session row, and Better Auth's `onUpdate` moved `updated_at` forward. That revived the session for every guarded endpoint, up to the absolute timeout.
- **Checked and found not exploitable:**
  - the organization plugin's other endpoints, which the hook keys on `ctx.path`;
  - sign-up, which is disabled;
  - set-active for a company the user is not a member of;
  - a spoofed host at sign-in, which can only pick among the user's own companies;
  - the web session bridge by email;
  - the rewrites, which control only the path;
  - CSRF and origins;
  - secret logging.
- **Configuration note, not a code bug:** keep `AUTH_ALLOWED_HOSTS` to our own domains. Never use a shared wildcard such as `*.vercel.app`.

## Fix
- `apps/api/src/core/auth/auth.ts`: the Better Auth `before` hook now runs `sessionExpiry` with the company's timeouts on every HTTP auth request that carries a session.
  - Exempt paths: sign-in, sign-out, verify-email, send-verification-email, request-password-reset, reset-password, ok and error.
  - An ended session is deleted, and the answer is 401 `session_expired`.
  - Direct server calls (`ctx.request` unset, as in `SessionService.verify`) are skipped, because SessionService runs the same check itself.
- `session-timeouts.ts` now exports `SESSION_ENDED_MESSAGES`, so the hook and SessionService share one set of messages.
- `apps/api/test/auth.int.test.ts` has 3 new tests:
  - set-active on an idle session answers 401 and does not revive it;
  - get-session on an idle session answers 401 and deletes the row;
  - a person whose session has ended can still sign in again.
- ADR 0029: one bullet added under "Per-company timeouts".

## Decisions and why
- **The check went into the hook, not into a new `last_activity_at` column.** It closes the bypass without changing an existing table, which CLAUDE.md says to ask about first. A dedicated activity column, written only by SessionService, would be stronger. It is an option for P9, but the owner has to agree to the table change.
- **Exempt paths form a short allow list.** Everything else is checked by default, so new Better Auth plugins (for example MFA in part 2) get the timeouts automatically.

## Commands run and results
- `pnpm lint`: 6 of 6 tasks pass.
- `pnpm typecheck`: 6 of 6 pass.
- `pnpm test`: 5 of 5 tasks pass.
- `pnpm test:api`:
  - api: 26 passed, including 21 auth integration tests.
  - db: 6 passed.
  - providers: 2 passed.
- Commit `22f330a`, `fix(api): apply company session timeouts on Better Auth endpoints`, pushed.
- `gh pr ready 2`, then `gh pr checks 2 --watch`:
  - `verify` passed in 4m0s.
  - `e2e` passed in 20m33s.
  - `fast` passed.
  - Vercel passed. Its build was skipped by the Ignored Build Step, as expected.

## Screenshots
None.

## What is left
- **Merge PR #2.** Person B reviews it and squash-merges it. Claude does not merge.
- **The `scratch-e2e` temp folder still exists.**
  - It is at `C:\Users\Admin\AppData\Local\scratch-e2e` and holds a single 24-byte file named `pw`, created at 12:36 today.
  - The delete command was denied in this session. Delete the folder by hand.
- **The local control database still holds the throwaway seed password.** The cleanup steps are in the previous session log.
- **Optional hardening for P9:** add a `last_activity_at` column on `session` that only SessionService writes. It needs the owner's approval.
- **P8 part 2 and P9**, as listed in the previous session log.

## Exact next prompt
For Person A, after PR #2 is merged:

> /resume. Create feat/auth-mfa from main and run blueprint prompt P8 part 2 (docs/real-build-plan.md week 2): TOTP with backup codes and passkeys through Better Auth, MFA required for Owner, Accountant, HR and platform admins (blueprint p27), rate limits and lockout, and `GET /public/branding?host=`. Read ADR 0029 first, including the note that every Better Auth endpoint gets the company timeouts. Plan mode first, and ask me for the lockout thresholds and anything else the blueprint leaves open.
