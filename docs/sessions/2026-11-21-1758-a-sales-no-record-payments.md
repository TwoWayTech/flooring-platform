# 2026-11-21 17:58, A: Sales views payments but does not record them (#53)

## Goal
Close click-through finding #53 under ADR 0061 decision 3: the default Sales role keeps
`sales.payment.view` and loses `sales.payment.record`; customised roles are never changed. Also fix
the accessible name of locked boxes in Settings → Security roles.

## What changed
- `packages/shared/src/permissions/roles.ts`: Sales template without `sales.payment.record`. The
  Summit and Keystone fixtures were regenerated (`pnpm --filter @workspace/shared fixtures`); only
  the Sales role's list changed. Role matrix snapshot updated.
- No migration or data fix. The seed inserts roles and permissions with `onConflictDoNothing`, so a
  database seeded before keeps the key until reseeded from scratch, and a company's saved role keeps
  what it holds. Reset to default reads `roleTemplate` in both the API (`RolesService.reset`) and
  DemoStore (`resetRole`), so it now gives Sales the new template.
- Permission matrix: a locked box with a tooltip is now itself the focus stop (`aria-disabled`,
  toggle ignored) instead of sitting in a focusable unnamed `<span>`, so its name is always
  "<permission>, <reason>". Owner and read-only locks stay `disabled`.
- Tests that relied on Sales recording: `invoices.int.test.ts` and the money run
  (`support/money-run.ts`) give their companies' Sales role the key, as a company may, so the
  own-scope two-person check stays covered. Demo e2e: `payments.spec.ts` now checks Sales has no
  Record payment; flow 1 in `flows-batch3.spec.ts` has Grace record the deposit (the Owner confirms
  if it waits). Api-mode flow F1: Grace records the deposit and final payment, each counted at once.
- Docs: permission tables in `settings-and-permissions.md` and `sales.md`, coverage regenerated,
  blueprint-delta row.

## Tests added
- shared `role-matrix.test.ts`: Sales views but holds no other payment key; only Owner, Manager and
  Accountant record.
- db `seed.int.test.ts`: the seeded Sales role has view, not record; a re-seed keeps a company's
  added key.
- api `invoices.int.test.ts`: a default Sales user gets 403 on `POST /payments` and 200 on
  `GET /payments`.
- web `permission-matrix.test.tsx`: locked box names and focus stop.

## Open questions
- Api-mode e2e no longer covers `POST /payments/:id/review` (F1 payments now count at once). It
  stays covered by five integration specs and the demo flows.

## Follow-up (coordinator's answer to the open question)
- New api-mode spec `apps/web/tests/e2e-api/payments-verify.spec.ts`: Grace records 1001.00 on the
  seeded open invoice with the largest balance; it shows Pending verification and the balance stays;
  Dana confirms it on Finance → Payments to verify and the balance drops by 1001.00; Grace then voids
  it so the invoice is back as it was (a clean-up voids it if the run stops midway).
  `POST /payments/:id/review` is covered in api mode again. Merged origin/main (no conflicts).
