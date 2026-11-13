# 2026-11-13, Person A: reviews and merges for B, P8 part 2 review and fixes, self-merge rule

## Goal
B's internet was down, so A did B's reviews and merges:
- review PR #2 (P8 part 1) and fix what the review finds;
- rebase and merge PR #3 (Claude tooling);
- rebase P8 part 2 (`feat/auth-mfa`, PR #4) and check it against the owner's numbers;
- add the owner-approved self-merge rule;
- run the security and schema reviews on PR #4 and fix what they find;
- hand off, mark PR #4 ready and merge it under the new rule;
- then start the work queue: P9, P10, then the notifications core.

## Prompts used
The owner's instructions this session (summarised; there were three):
1. Review PR #2 with a fresh subagent and fix its findings. Rebase #3 and resolve the docs conflict. Review #3 the same way.
2. Rebase `feat/auth-mfa`, check the approved P8 part 2 numbers, and add the self-merge rule to `.claude/settings.json` and CLAUDE.md. Run the security-reviewer on PR #4, then hand off, mark it ready and merge it. Delete `feat/tooling-claude-agents` on origin. Then run the work queue (P9, P10, notifications core) without stopping to ask.
3. Before marking #4 ready: revert anything the reviewer edited, make the security-reviewer strictly read-only, fix the four schema should-fix items (retention decision: 30 days), and add the reset-email limit to STATUS.

## Branch and PR
`feat/auth-mfa`, PR #4, rebased onto main at `371f1ab` (after #3 merged).

## What happened, in order
1. **PR #2 review.** A fresh general-purpose agent reviewed the diff and found no high-severity defects. The fixes are now in `7b38fd8`, on this branch:
   - `set-active` refuses `null` and `organizationSlug`. `null` escaped the company's timeouts.
   - On a company's host, `set-active` refuses any other company.
   - Production needs exact `AUTH_ALLOWED_HOSTS`, with no wildcard and no `localhost:*` fallback.
   - Deleted companies never open.
   - Two findings were rejected after checking the code. Blocking suspended and cancelled companies: the blueprint (p29, about p40) lets them sign in read-only. Dropping `useSecureCookies`: with a dynamic base URL, Better Auth falls back to `isProduction` anyway.

   PR #2 was merged while the fix was being written, so the fix rides on this branch instead.
2. **#2 and #3 merged** (`31e2297`, `ab57891`). PR #4 had been built in the meantime by another run and sat on the old main.
3. **Rebase.** One conflict in docs/STATUS.md. The first resolution attempt used Python, which is not installed, so the conflict markers were committed. `a8a9fb5` fixes it. Use the Edit tool for conflict resolution on this laptop.
4. **Owner's numbers.** The code matched the owner's numbers for lockout, rate limits, TOTP period, backup codes (Better Auth's view endpoint is server-only, so they are shown once), enrolment with no grace period, and passkey-counts-as-MFA. Reset emails don't exist yet.
5. **Self-merge rule** (`dd23e01`):
   - `.claude/settings.json` removes the blanket `gh pr merge` deny and allows `gh pr merge * --squash*`.
   - It denies `--admin`, `--merge`, `--rebase`, `-m`, `-r`, and `gh api` merges. Every push-to-main deny stays.
   - CLAUDE.md gets the rule, the PR template gets the exception, and docs/blueprint-delta.md has a row.
6. **First security review went wrong.** It ran as a general-purpose agent, because the `security-reviewer` type was not loaded in this session yet, and it edited 9 source files.
   - All of those edits were reverted. They were saved under the session scratchpad as `reviewer-edits.patch`.
   - It also wrote two test files after the tree was checked clean. `git commit -am` swept them into `7cd542e` with a misleading message. They were reviewed and kept (they test the fixes below), and `7d469f4` records this.
   - `.claude/agents/security-reviewer.md` now has `disallowedTools: Edit, Write, NotebookEdit` and an explicit Bash read-only list.
   - **Lessons:** always use the typed reviewer agents, and stage files by name rather than `-am` while subagents run.
7. **Schema review** (sonnet): nothing blocking. `24bfecf` fixes all four should-fix items:
   - the seed sets `member.role` only on insert;
   - data-model rows for `member.role`, `auth_attempts` and `rate_limit`;
   - 30-day retention (owner decision) in the data model and ADR 0029;
   - the cleanup job is a STATUS follow-up for the notifications core.
8. **Security review** (`security-reviewer` type, read-only) found 4 blocking issues. `7d469f4` fixes them, plus the two medium ones:
   - **Per-IP limits trusted a spoofed `x-forwarded-for`.** The API now reads only `x-client-ip`. The web proxy (`withAuthProxyHeaders`) strips browser copies, sets the IP from the edge's `x-forwarded-for` and adds `AUTH_PROXY_SECRET`. `settleClientIp` trusts the IP only with that secret.
   - **Parallel guesses beat the lockout.** Each attempt is checked and recorded before the password check, under a per-address advisory lock. The email limit uses the same lock (`reserveEmail`).
   - **Passkey registration could start a new session.** `createSession` is refused. Adding a passkey needs `/verify-password` in the last 5 minutes and a session at most 10 minutes old (`freshAge`), and it emails the account.
   - **The passkey rpID fell back to `localhost`.** It now comes from `PASSKEY_RP_ID`, the production base URL is https, and user verification is required.
   - **Medium:** confirming TOTP keeps the session's start time.
   - **Medium:** the email limit is atomic.
   - **Deferred to STATUS:** MFA by role content rather than key (before P10 role management), and a rate limit on `/public/branding`.
9. A fresh security re-review of the whole PR follows before merging (see the PR comment).

## Decisions and why
- **Retention: 30 days** for `auth_attempts` and `rate_limit` (owner). Lockout and MFA audit events follow the audit log's retention.
- **Client IP through a shared secret, not trusted proxy IPs.** Vercel functions have no fixed egress IPs, so a list of trusted proxies would not work. The web host must sit behind an edge that overwrites `x-forwarded-for` (Vercel does). This is recorded in ADR 0029 and the blueprint delta.
- **Passkey password step-up applies to everyone, not only users who already have a factor.** It is simpler and safer, and the web passkey screens (B's) don't exist yet, so nothing breaks.
- **One relying party (`PASSKEY_RP_ID`).** If Flooring and HR get different registrable domains, decide one relying party per product together with the domain (an open question in docs/real-build-plan.md).

## Commands run and results
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check`: pass.
- `pnpm test`: shared 330, api 28, web 11, db 8, providers 11; all pass.
- `pnpm test:api` (Docker Postgres): api 66, db 6, providers 2; all pass. This includes the new parallel-guess, parallel-email, spoofed-IP, TOTP start-time and passkey step-up tests.
- Playwright api-mode e2e was not run locally (memory). CI `verify` and the full browser suite run it on the ready PR.

## Screenshots
None. No screen changed in these fixes.

## What is left
- Mark PR #4 ready once the re-review passes, watch the checks, and squash-merge under the CLAUDE.md rule.
- Delete `feat/tooling-claude-agents` on origin.
- The work queue: P9, then P10, then the notifications core (which brings pg-boss and the 30-day cleanup job).
- Before production: set `AUTH_PROXY_SECRET` on both api and web, set `PASSKEY_RP_ID`, and list exact `AUTH_ALLOWED_HOSTS`.

## Next prompt
"/resume. Continue the work queue from STATUS: P9 (R3) on feat/tenancy-company-databases from an up-to-date main."
