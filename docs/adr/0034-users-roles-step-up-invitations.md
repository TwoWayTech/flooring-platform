# ADR 0034: Users, roles, step-up, invitations and support access (P10 part 2)

- **Status:** accepted, 2026-11-13
- **Context:** P10 part 1 (ADR 0031) enforces permissions on every request. Nothing yet changed them on the server: no Users or Roles API, no step-up, no invitations, no password reset and no support access. The owner's second work queue asked for all of these. The settings spec describes the demo's screens only, so the server design is drafted in docs/specs/settings-users-access.md.

## Decision
- **Users and Roles API** (`apps/api/src/modules/users`):
  - **Endpoints:** `GET /users`, `POST /users/invite`, `PATCH /users/:id`; `GET /roles`, `POST /roles`, `PUT /roles/:id`, `POST /roles/:id/reset`, `DELETE /roles/:id`; `GET /audit`.
  - **Rules applied:** no escalation (`escalations` and `canAssignRole` from packages/shared), the last active Owner, the plan's seat limit, the locked Owner role, and the role-delete rules.
  - **Records:** every change writes `audit_log` in the same transaction.
- **Nobody acts on someone who holds more (PR #11 security review):**
  - Changing another person's roles or status, or resetting their MFA, needs every role that person holds to be one the actor could give (`canManageHolder`); only an Owner changes an Owner.
  - Changing, resetting or deleting a role needs the actor to be able to give that role.
  - Data scope counts too: a role's scope may not be wider than the actor's own (`scopeWidens`, and `scope_wider` from `canAssignRole`); Owners hold every scope.
  - Status changes also need a step-up, and a platform admin's MFA can only be reset by platform support.
- **MFA by role content:** a role needs MFA when it is the Owner role or holds a key in `MFA_REQUIRED_KEYS`. Assignments and role edits write `member.role` as the role keys plus an `mfa` marker, so sign-in still decides before any company database opens (ADR 0029). Copies of the Accountant and HR roles now keep the rule.
- **Step-up:**
  - **Checking:** `POST /auth/step-up` checks a TOTP or backup code through Better Auth's own verify endpoints, against the session's user. A pass is written to `auth_attempts` (`step_up_ok`, keyed by session) and lasts 5 minutes.
  - **Lockout:** each code is recorded (`step_up_attempt`) before it is checked, under a per-user advisory lock, exactly like password attempts; a pass writes `step_up_pass`. 5 failures in 15 minutes lock step-up for 15 minutes, so parallel guesses cannot get past the limit (PR #11 security review).
  - **Backstop:** PermissionGuard refuses `mfa_enrolment_required` on every company request when a held role needs MFA by content and the person has no factor, in case `member.role` missed a change.
  - **Where it is required:** role changes, MFA resets, role saves, resets and deletes, and support approvals all call `StepUpService.require`.
  - **Passkey-only people:** they step up with a fresh passkey sign-in.
- **Invitations** (`user_invitations`, control migration 0004):
  - **The token:** 32 random bytes; only the SHA-256 is stored. It lasts 7 days and works once.
  - **Accepting:** sets the password of a new account, verifies the email and activates the profile. The claim is one conditional update.
  - **Public endpoints:** they share a per-IP limit.
  - **Reaching the profile:** the company profile is reached through `JobTenants`, so the TenantGuard checks apply. Lint allows only `invitations.service.ts` to do this.
- **Password reset:** Better Auth's endpoints, with `sendResetPassword` taking from the shared 3-an-hour per-address email budget. Links last one hour, and a reset ends every session.
- **Support access:** a platform admin requests access, and the company's Owner approves it (with a step-up) or revokes it. Both write `platform_audit_log` and `audit_log`. Using a grant comes with P17.
- **Web:**
  - **Routes:** `routeClient` factories receive the demo client, so `list` and `get` go to the API for `users`, `roles` and `audit` only.
  - **API_METHODS:** gains the Users and Roles methods and `verifyStepUp`.
  - **Step-up:** the step-up dialog asks the API.
  - **New pages:** `/forgot-password`, `/reset-password` and `/accept-invite`.

## Consequences
- **Hybrid api mode:** other screens still read demo collections, so a demo record's user id may not match an API user until its module moves.
- **Invitation limit:** the invitation endpoints count by the socket IP the API sees. Behind the web proxy that is the web server's IP until these routes go through the auth proxy (STATUS).
- **Support access:** a grant opens nothing yet. P17 must build read-only access from an approved, unexpired grant, with every read audited.
