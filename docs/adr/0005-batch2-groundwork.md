# ADR 0005: Feature batch 2 groundwork: saved-data version, store-side permission checks, new keys

Date: 2026-11-08. Status: accepted.

## Context
Feature batch 2 (docs/specs/feature-batch-02.md, plan in docs/specs/feature-batch-02-plan.md) changes many record shapes. Browsers that used the demo hold a localStorage overlay with no version, so the new code would read old shapes. The spec also asks for permission checks in the save logic, not only in the UI, and adds permissions (payments, tax override, waste, commissions, stock, transfers, supplier payments, data import) that the spec names outside the app's `module.resource.action` scheme.

## Decision
- The overlay carries `schemaVersion: 2` under the prefix `fp-demo:v2:`. On open, version 1 data (`fp-demo:v1:`) is upgraded by pure steps in `packages/shared/src/migrations` and saved as version 2; if a step fails, that company starts fresh and the app shows one notice through `ApiClient.takeNotices()`. Reset demo data clears both prefixes.
- Every DemoStore action checks the viewer's effective permission before it changes anything (`assertCan`). The generic `save` takes its keys from one table per collection (`lib/api/demo/permission-rules.ts`); collections only the store writes refuse generic saves. "View as" limits saves too.
- New keys keep the scheme (plan K-2): `sales.payment.{record, approve, void, refund, write_off, apply_credit}`, `sales.tax.override`, `sales.waste.view`, `sales.commission.{view, manage}`, `inventory.stock.{adjust, approve}`, `inventory.transfer.{view, create, receive}`, `inventory.reservation.override`, `purchasing.payment.{record, approve, void}`, `settings.{payments, locations, import}.manage`. Retired: `sales.payment.create` → `sales.payment.record`, `purchasing.bill.pay` → `purchasing.payment.record`, `hr.commission.view` → `sales.commission.view` (commissions follow data scope, plan K-3).
- Default roles follow spec Appendix A and the batch: Sales no longer records payments; approve, void, refund, write-off and credit are Owner and Accountant; tax override is Owner and Accountant; waste is visible to Owner, Manager, Accountant and Warehouse.

## Consequences
- Each later model change of the batch adds one upgrade step to `V2_RECORD_STEPS` and a unit test.
- The role-matrix snapshot changed on purpose (default roles above).
- A screen that forgets a permission check still cannot change data the role may not change.
