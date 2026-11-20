# Settings → Users, invitations, password reset, step-up and support access (draft spec)

Drafted by Claude on 2026-11-13 for P10 part 2. docs/product-spec/settings-and-permissions.md covers users and roles as the demo has them. It has no server design for invitation acceptance, password reset, step-up or support access, so the owner's work queue asked for this draft (recorded in docs/blueprint-delta.md). Sources: the demo's Users and Roles screens, blueprint p27 to p31 (Security; Users, roles and super-admin access), and ADR 0029.

## Users and roles API (from the demo's screens)

| Screen action | ApiClient method | Endpoint | Needs |
| --- | --- | --- | --- |
| List users | `list("users")` | `GET /users` | `settings.users.view` or `settings.users.manage` |
| List roles | `list("roles")` | `GET /roles` | `settings.roles.view`, `settings.roles.manage`, `settings.users.view` or `settings.users.manage` |
| Audit log | `list("audit")` | `GET /audit` | `settings.audit.view` |
| Invite user | `inviteUser` | `POST /users/invite` | `settings.users.manage` |
| Change roles, status, branch, title, reset MFA | `updateUser` | `PATCH /users/:id` | `settings.users.manage`; step-up for roles, status, branch and MFA reset |
| Create or edit a role | `saveRole` | `POST /roles`, `PUT /roles/:id` | `settings.roles.manage` and step-up |
| Reset a role | `resetRole` | `POST /roles/:id/reset` | `settings.roles.manage` and step-up |
| Delete a role | `deleteRole` | `DELETE /roles/:id` | `settings.roles.manage` and step-up |
| Step-up code | `verifyStepUp` | `POST /auth/step-up` | a signed-in session |

**Branches (ADR 0051, 2026-11-20).** An invitation or a change names no branch or one of the company's live branches; anything else is refused (400 `unknown_branch`), never stored as no branch. Someone whose data scope is below `all` invites only into their own branch, changes only people in their own branch (roles, status, title, branch, MFA reset; oneself excepted), and moves them only to their own branch (403 `branch_other`; `branchPlacementDenial` and `branchManageDenial` in packages/shared, applied by the API and DemoStore). The invite dialog says so before the code is asked for when such an admin has no branch. The invite's audit row records the branch stored.

The spec's business rules 10 to 15 apply on the server:
- **No escalation (rules 10 and 11):** a role save may add only keys the granter holds; it may keep keys the role already had. Assigning a role needs every active key of that role, and only an Owner can make an Owner.
- **The Owner role is locked (rule 12).**
- **Last Owner (rule 13):** a change that leaves no active user with the Owner role is refused.
- **Seat limit (rule 14):** active and invited users count. The limit is the plan's `max_users`, or the subscription's override; with no plan (a trial), there is no limit.
- **Role delete (rule 15):** system roles and roles someone holds cannot be deleted.

Every change writes `audit_log` with the before and after values.

## MFA by role content
- **The rule:** a role makes MFA mandatory when it is the Owner role, or when it holds any key in `MFA_REQUIRED_KEYS` (packages/shared). That set covers payments approval, voids, refunds and write-offs, the tax override, payroll, sensitive HR, commission approval, tax, payments and HR settings, user and role management, and the financial export. The default Owner, Accountant and HR manager roles hold such keys, so a copy of one keeps the rule.
- **Sync:** whenever roles are assigned or a role's keys change, `member.role` is kept in sync for everyone affected. It holds the role keys plus the marker `mfa` when any held role needs MFA, so sign-in can decide before any company database is open.

## Step-up
- **When it is needed:** inviting someone (it gives roles), changing roles, status or branch, resetting MFA, saving, resetting or deleting a role, and approving support access (PR #11 security reviews). Each needs a step-up from the last 5 minutes.
- **How to step up:** `POST /auth/step-up { code }` checks a TOTP code or a backup code against the person's own factor and records it against the session (`session_step_ups`). Wrong codes count toward the second-factor lockout: 5 lock the step-up for 15 minutes.
- **Passkey-only users:** someone with a passkey and no authenticator app steps up by signing in again with the passkey. A session under 5 minutes old counts as a step-up for them.
- **No factor:** someone with no factor at all cannot step up. The answer is 403 `step_up_mfa_required`.
- **Missing step-up:** without a valid step-up, these endpoints answer 403 `step_up_required`.

## Invitations
- **Inviting:** creates the account with no password, the membership, a company profile with status `invited`, and the roles. It then emails a link (`/accept-invite?token=…`) through EmailProvider. The token is 32 random bytes; only its SHA-256 is stored, in `user_invitations`. It is valid for 7 days and used once. Inviting the same email again replaces the old token.
- **Accepting:** `GET /public/invitations/:token` names the company and email for the page. `POST /public/invitations/accept { token, password }` then:
  - sets the password (12 characters at least);
  - marks the email verified;
  - turns the profile `active`.
- **After accepting:** the person signs in, and a role that needs MFA must enrol before anything else (ADR 0029). Both public endpoints share the sign-in limit of 10 a minute per IP.
- **Someone who already has an account:** for example, a member of another company. They are added with no password change, and their profile is `active` once they sign in. The email says so.

## Password reset
- **The flow:** Better Auth's `/request-password-reset` and `/reset-password`, with the link going to `/reset-password?token=…` on the web host. The answer is the same whether or not the address exists.
- **Limits:** 3 reset emails an hour per address, through `AttemptLog.reserveEmail`, which also counts verification emails. A reset ends every session of the account.
- **What it does not change:** it does not remove MFA. Someone who lost their factor needs an MFA reset by an admin with `settings.users.manage`.

## MFA reset by a company admin
- **What it removes:** the person's authenticator app, backup codes and passkeys.
- **Shared accounts:** if the person also belongs to another company, the reset is refused (409 `shared_account`), so one company cannot weaken another's security. Platform support handles those accounts.

## Support access (blueprint role rule 6)
- **Requesting:** a platform admin requests read-only access to a company for a reason and a time, at most 72 hours: `POST /platform/support-grants`. Since ADR 0052 the route sits behind `PlatformAdminGuard`: an active admin with role `owner` or `support`, a step-up from the last 5 minutes, a strict body, and 404 while `admin.access` is off (docs/specs/platform-admin.md).
- **Limits (ADR 0053):** one open request (pending or approved, unexpired) per admin and company, else 409 `grant_open`; at most 10 requests per admin in 24 hours, across companies and counting revoked, expired and deleted ones, else 429 `rate_limited`. Both are checked under a lock on the admin's own `platform_admins` row, which also re-checks that they are still an admin (403). The console lists the requests with `GET /platform/support-grants`: the platform `owner` role sees every admin's, the `support` role its own, never the approver. The status uses the same shared rule as the Owner's `GET /support-grants`.
- **Approving:** the company's Owner approves with step-up (`POST /support-grants/:id/approve`), or revokes while the company is in full use (`POST /support-grants/:id/revoke`), in Settings → Users (Support access panel, ADR 0054). While the company is read only, TenantGuard refuses both (403 `company_read_only`) and the panel shows no actions; requests end on their own. `GET /support-grants` lists them for Owners.
- **Audit:** the request writes `platform_audit_log` only (`support.requested`, with the IP and user agent). Approving and revoking write `platform_audit_log` and the company's `audit_log`.
- **Deferred:** using a grant to open the company read-only was planned with the platform-admin screens (P17). ADR 0052 defers it to the owner, because it is a tenancy change. Until then a grant gives no data access.
