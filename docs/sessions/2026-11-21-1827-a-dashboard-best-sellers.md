# 2026-11-21 18:27 (A): dashboard best sellers name their products

Branch `fix/dashboard-best-sellers`. Closes click-through #1 (major) and #2 (minor).

## Goal
- #1: in api mode the dashboard's Best sellers showed amounts with no product names, as bars and as a table, for the Owner (and Sales).
- #2: docs/demo-script.md step 1 said best sellers follow the dashboard's period; they have their own period and category (blueprint-delta 2026-11-09, ADR 0017). Script fixed, product unchanged.

## Cause of #1
`useDashboardData` read invoices from the API (`SERVED_LISTS` has `invoices`) but `list("products")` still went to DemoStore, so no invoice line's `productId` matched a catalog id and `products.find` gave `undefined`. Nothing was stripped as sensitive; the API's products carry names for Sales and Owner alike.

## What changed
- `apps/web/src/lib/api/http/api-methods.ts`: `products`, `rolls` and `stockMovements` join `SERVED_LISTS` (GET /products, /rolls, /stock-movements, inventory part 1); `list`/`get` read a 403 or a switched-off 404 as an empty list (`seenOrOff`). Only the dashboard (slow movers, best sellers) and Needs attention's low-rolls count call these through `list`.
- `packages/shared/src/dashboard.ts`: `SellerRow.name`, the catalog's name or else the line's description, so a row is never blank.
- `apps/web/src/features/dashboard/best-sellers.tsx`: bars and table split into exported `BestSellerBars` and `BestSellerTable`; both show the swatch (when the catalog has the product) and the name.
- docs/demo-script.md step 1; docs/blueprint-delta.md row; coverage list regenerated (`demo-only.ts` loses the three entries; docs/coverage.md, page-coverage.json).

## Tests
- API: `apps/api/test/invoices.int.test.ts`, "names every best seller for the Owner and for Sales".
- Unit: `apps/web/tests/unit/dashboard-best-sellers.test.tsx` (bars and table names and swatches, the unmatched-catalog fallback, `list` routing and 403/404).
- Api-mode e2e: `apps/web/tests/e2e-api/sales.spec.ts`, Sales' dashboard test asserts a named bar and table row; a new Owner flow test does the same.
- Shared: `dashboard-without-cost.test.ts` expects the new `name`.

## Checks run
See the PR body. Playwright not run locally (shared laptop); CI runs it.

## Open questions
None.
