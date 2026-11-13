# 2026-11-13, Person A: P10 part 2, Settings → Users and Roles

## Goal
Owner's second work queue (2026-11-13), task 2: blueprint P10 part 2 with the settings-and-permissions spec. That covers:
- no-escalation on grants;
- step-up MFA on role changes;
- support-access grants;
- Settings → Users with invitations, where accepting sets the password and MFA;
- password reset with the 3-per-hour email limit.

Missing specs are drafted in docs/specs/settings-users-access.md and recorded in the blueprint delta.

## Prompt used
The owner's work queue of 2026-11-13 (second), task 2. Spec: docs/product-spec/settings-and-permissions.md, business rules 10 to 15, plus the new draft docs/specs/settings-users-access.md.

## Plan
1. **packages/shared:**
   - `MFA_REQUIRED_KEYS` and `roleRequiresMfa`, so MFA follows what a role can do;
   - the `mfa` marker in `member.role`;
   - unit tests.
2. **packages/db (control):**
   - `user_invitations` (token hash, company, user, expiry, accepted, revoked);
   - `session_step_ups` (session, verified at).

   Migration 0004.
3. **apps/api, `modules/users`:**
   - `GET /users`, `POST /users/invite`, `PATCH /users/:id`;
   - `GET /roles`, `POST /roles`, `PUT /roles/:id`, `POST /roles/:id/reset`, `DELETE /roles/:id`;
   - `GET /audit`.

   Each applies no-escalation, the locked Owner role, the last-Owner rule, the seat limit, the role-delete rules, the `member.role` sync and audit.
4. **apps/api, `core/auth`:**
   - `POST /auth/step-up` and the step-up check;
   - invitation endpoints (public);
   - Better Auth `sendResetPassword` with the shared 3-per-hour limit;
   - MFA reset.
5. **Support grants:** the platform request, and the company list, approve and revoke endpoints.
6. **apps/web:**
   - `list` routes per collection;
   - the Users and Roles methods in API_METHODS;
   - `verifyStepUp` in StepUpDialog;
   - pages for accepting an invitation, forgotten password and reset.
7. **Tests:** API integration tests (escalation, last Owner, seats, step-up, invitations, reset, support grants, isolation), Playwright api-mode tests, and unit tests.
8. **Docs:** an ADR, the API contract, the data model, the blueprint delta and STATUS.
