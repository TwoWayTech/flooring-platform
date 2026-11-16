# ADR 0057: Data import on the API, part 1 (customers, addresses, suppliers, products)

- **Status:** accepted, 2026-11-16. Built overnight on `feat/import-api` (PR #41) under the owner's rule for this queue: follow docs/product-spec/import.md as the approved behaviour, deviate only in the safer direction (less exposure, deny by default, refuse what can't be done correctly), record each deviation in docs/blueprint-delta.md, here and the spec's "Real build (ADR 0057)" section, and defer what needs the owner. The safer deviations and the questions under "For the owner" are open for the owner's review.
- **Context:**
  - docs/real-build-plan.md, module 16 ("Data import and opening balances") and the week-19 gate, "Summit's demo data imports through the wizard".
  - docs/STATUS.md:
    - "Next three tasks": meetings, platform admin, reports, then import, then the cross-module api-mode e2e flows;
    - the third review's question whether `settings.import.manage` belongs in `MFA_REQUIRED_KEYS`;
    - the PR #12 follow-up: `products_sku_uidx` is not partial on `deleted_at`;
    - the PR #39 review notes: CSV cells that start like a formula;
    - "Documents that never posted … The import must post its opening-balance entry first".
  - The behaviour is docs/product-spec/import.md, written from the demo on 2026-11-10, and ADR 0019: the file is parsed in the browser's Web Worker with Papa Parse 5.5.3 and SheetJS 0.20.3, and records match by External ID, then email, then name.
  - The module specs that approve what the import writes: sales.md:742 "The credit limit comes from the seed or an import"; import.md:312 (the Sales rep column); inventory.md:509 "Products have no form … They come from the seed or an import"; ADR 0035 "Product creation and editing have no screen"; purchasing.md (suppliers and their contacts).
  - **Where things stood at `9cb7c73`:**
    - Import ran only in the browser. `importOverview`, `previewImport`, `runImport`, `undoImport` and `saveImportMapping` were not in `API_METHODS`, so in api mode Settings → Data import read and wrote DemoStore. `/admin/companies/*/import` was "not found" in api mode.
    - The company tables `import_jobs` and `import_mappings` already existed (packages/db `src/company/system.ts`). Their unique indexes on `number` and `kind` ignore `deleted_at`.
    - The API had no product create or edit (`inventory.controller.ts` has GETs, transfers, the roll PATCH and corrections). The sales module never writes a customer's credit limit, rep or external ID, and purchasing never writes a supplier's categories or external ID. **The import is the first writer of all of these** (section 6).
    - HR's `POST /timesheets/upload` already ran the shared `planImport` and `readCell` on the API (ADR 0046).
  - **Precedents in the API:**
    - `StepUpService` (roles, users and support grants, ADR 0034);
    - `AuditService.record` inside the caller's transaction (ADR 0031);
    - the global `SensitiveFieldsInterceptor`, which strips `creditLimit`, `cost` and the other reserved names at any depth, snake_case included (`credit_limit`);
    - `lockStock` (`inventory/stock-lock.ts`), which receipts, transfers, corrections and invoices take before they change stock or average cost;
    - the module loaders `loadCustomers`, `loadSuppliers`, `loadContacts` and `loadProducts`; `requireFeature` and `companyClock` (`sales-common.ts`); `loadNames` (`invoice-records.ts`); `minuteIn` (`reports/report-records.ts`).

Code comments cite this ADR by label: `S-1` to `S-20` are the safest options; `M1` to `M7`, `R1` to `R5` and `S14` are the review items; `api 4.n` and `plan 5.n` are the numbered sections below.

## Decision

### 1. Shape
- **One plan for both sides.** `planImport` and each kind's `resolve` stay in `packages/shared/src/import`. The API and DemoStore call them on their own records, with new shared rules for access, limits, decimals, ambiguity, lookups and the Undo comparison.
- **The server never parses a file.** The browser's worker turns it into `{ headers, rows }` of text cells. The web sends only the chosen columns, as JSON. The API reads every cell again with the shared `readCell`, and stores no file. There is no new dependency and no file storage.
- **Safety in one line each:**
  - the company comes from the session only;
  - the person needs `settings.import.manage`, company-wide data scope, the kind's own view, create and edit keys, and the key of any sensitive column chosen;
  - an import and an Undo need a step-up;
  - all valid rows commit in one transaction, under a per-company import lock and table locks, planned again against the records as they are and refused if any row would now do something other than the dry run showed;
  - one `audit_log` entry per record plus one for the batch;
  - Undo works only while every record still equals what the import wrote, every reference it puts back is live, and no live record points at one it created.
- **No new table, migration, dependency or switch.** Nothing changes in `apps/api/src/core`, `packages/db`, `packages/shared/src/features.ts` or `apps/api/src/app.ts`.

### 2. The parts
Part 1 (this ADR) is the master data:

| Kind | Writes | Module | Record switch (404 when off) | Keys needed (all) | Sensitive columns (keys needed when chosen) |
| --- | --- | --- | --- | --- | --- |
| `customers` | `customers`, `addresses` | `core` | `sales.customers` | `customers.customer.view`, `.create`, `.edit` | `credit_limit`: `customers.customer.view_sensitive` |
| `addresses` | `customers` (the whole record), `addresses` | `core` | `sales.customers` | `customers.customer.view`, `.edit` | none |
| `suppliers` | `suppliers`, `supplier_contacts` | `core` | `purchasing.suppliers` | `purchasing.supplier.view`, `.create`, `.edit` | `credit_limit`: `customers.customer.view_sensitive` **and** one of `inventory.product.view_sensitive`, `purchasing.bill.view` |
| `products` | `products` | `core` | `inventory.products` | `inventory.product.view`, `.create`, `.edit`, `.view_sensitive`, `purchasing.supplier.view` | `cost` (required, so its key is a kind key) |

Why these four: none posts to the ledger, because no money moves; none touches pay; their loaders already exist on the API; and Undo can be made exact for them. Every other kind answers 404 "This kind of import is not available." on the API. The demo keeps all nine kinds under the same access rules. The rest waits for later parts (below).

### 3. Shared rules (`packages/shared/src/import`)
- **`access.ts`** (new): `IMPORT_KIND_KEYS`, `IMPORT_KIND_FEATURES`, `IMPORT_SENSITIVE_COLUMNS`; `importKindRefusal` (module 403, switch 404, data scope 403, keys 403, in that order), `sensitiveColumnRefusal`, `importKindsOpen`, `hiddenSensitiveFields`; `ImportHolder` (effective keys and data scope, required) and `FULL_IMPORT_HOLDER` (DemoStore's platform admin only).
- **`limits.ts`** (new): `IMPORT_LIMITS` (2,000 rows, 60 columns, 1,000-character cells, 200-character headers and file names, a 100,000-byte request), `importRequestProblem`, `mappingFor` (only the kind's own fields; `__proto__` and any other key refused; only own properties read), `mappedTable` (the chosen columns in field order, every row kept), `IMPORT_TOO_LARGE`.
- **`lookups.ts`** (new): indexes by key built once per plan and kept current as rows write, so planning is linear in rows plus records (M7). External IDs and names compare folded; emails compare exactly, ignoring case only; SKUs compare in lower case. A key that finds several records is a row error (S-16).
- **`canonical.ts`** (new): `sameRecord`, a comparison by content, so a different key order (jsonb sorts keys) is never a change. `patched` uses it too.
- **`undo.ts`** (new): `batchSummary` (field by field, without `changes`), `countsText`, `importAuditAction`, `recordName`, `IMPORT_WORDS` (the words both modes refuse and record with), `productUndoProblem` (S-5, M4, M6).
- **`fields.ts` (`readCell`)**: in this order, control characters (S-17), empty or required, the field's length, the type, then digit caps and more-than-0. Money has at most 10 whole digits. Trailing zeros are not decimals ("23.6400" passes a 3-decimal limit); money keeps the spec's two-decimals-as-typed rule.
- **`plan.ts`**: `planActions` (the action per row, such as "ccse"); a row with nothing in any chosen column is left out as blank (S-19); `workingCopy` copies `supplierContacts` too.
- **`mapping.ts`**: `autoMap` takes the fields to skip, so a sensitive column the person can't use is never chosen for them (S-20).
- **Kinds:** field lengths and digit caps from each module; customers and addresses keep at most 50 addresses per customer (the sales route's own cap); a new supplier without terms pays on order (S-9); categories compared as a set and written in catalog order; a supplier's stored address kept when the file's four fields match it (folded), otherwise the four given replace it and the county goes; the product rules (section 7). `ImportUser` has an optional `branchId`, set only by the demo for its opening invoices.

### 4. The API (`apps/api/src/modules/imports`)

#### 4.1 Files
`imports.module.ts` (imports `AuthModule` for `StepUpService`; registered in `app.module.ts`), `imports.controller.ts`, `imports.service.ts`, `import-input.ts` (Zod), `import-access.ts` (`openKind`, `openColumns`, `openKinds`, `SERVER_IMPORT_KINDS`), `import-lock.ts` (`takeImportLock`, `limitLockWait`, `importFailure`), `import-records.ts` (batches, saved columns, members, retired SKUs, products with stock, live suppliers), `import-references.ts`, `import-audit.ts`, `kind-store.ts`, `kind-stores.ts` (the registry, apart to avoid an import cycle), `customer-store.ts`, `supplier-store.ts`, `product-store.ts`.

Moved with no behaviour change: `customerAudit` to an export of `sales/sales-records.ts`, and `auditedSupplier` to an export of `purchasing/purchasing-records.ts`. `loadCustomers` now groups addresses and certificates in one pass (same output and order).

#### 4.2 Routes
`ImportsController` on `@Controller()`, both products, with no class-level module: `settings.import.*` is in the always-on `platform` module, and each request's kind is checked against its own module. Every handler has `@RequirePermission("settings.import.manage")`, calls `requireFeature("settings.import")` first (404 when off) and answers with `Cache-Control: private, no-store`. docs/api-contract.md, "Data import, part 1 (real build, ADR 0057)".

| Route | Status | Body → answer |
| --- | --- | --- |
| `GET /imports` | 200 | `ImportOverview { kinds, mappings, batches }`: the kinds the person may import here, in wizard order; the saved column choices of those kinds only; the newest 200 live batches as `ImportBatchSummary` |
| `POST /imports/check` | 200 | `ImportRequest` → `ImportPreview { rows, counts }`. The dry run: writes nothing and makes no audit entry |
| `POST /imports` | 201 | `ImportRequest` plus `expected` → `ImportResult { batch, rows }`. Step-up |
| `POST /imports/:id/undo` | 201 | No body → `ImportBatchSummary` with `undoneAt` and `undoneBy`. Step-up |
| `PUT /imports/mappings/:kind` | 200 | `{ columns }` → `ImportMapping { id, kind, columns, savedAt }` |

`ImportBatchSummary` is `{ id, number, kind, fileName, at, byName, mapping, counts, undoneAt, undoneBy }`. `byName` and `undoneBy` are the control-database names of `created_by` and `undone_by`, or "Former user" when the sign-in is gone. `changes` never leaves the server.

#### 4.3 Request checks (`import-input.ts`)
Strict Zod bodies, 400 `invalid_request`:
- an unknown field anywhere, a `companyId` above all: "The request has a field this import doesn't take." (CLAUDE.md rule 2);
- `kind`: "Choose what to import."; `fileName` trimmed, 1 to 200 characters ("Name the file.", "A file name is at most 200 characters.");
- `table.headers`: 1 to 60, each at most 200 characters, each once ("The file has no header row.", "A file can have at most 60 columns.", "A column header is longer than 200 characters.", "Two columns have the same header. Rename one and try again.");
- `table.rows`: 1 to 2,000, each at most 60 cells of at most 1,000 characters, no NUL ("The file has no rows under the header row.", "Import at most 2,000 rows at a time; split the file.", "A row has more than 60 cells.", "A cell is longer than 1,000 characters. Shorten it or leave that column out.", "A cell holds a NUL character. Remove it and try again.");
- `mapping` (and `columns`): at most 60 choices ("Choose at most 60 columns."); a header, file name or choice with a control character: "A column name or file name holds a hidden control character."; a `__proto__` key (checked on the raw body, because Zod 4 would drop it silently) or a key over 60 characters: "The column choices name a field this import doesn't have.";
- `expected` (the import only): 1 to 2,000 of `c`, `u`, `s`, `e`, else "Check the file again before importing.".

Then `mappingFor` (a field the kind doesn't have) and `importRequestProblem` (a mapping problem, a chosen header that isn't in the file, the row count, a chosen cell over 1,000 characters), each 400 with its words. An unknown `:kind` in the mapping route is 400 "Choose what to import.". The body parser's 100 KB limit is unchanged: a larger body gets its own 413.

#### 4.4 Order of checks
1. SessionGuard (401), TenantGuard (the company from the verified session; a read-only company gets 403 `company_read_only` on every request but a GET, the dry run included), PermissionGuard (`settings.import.manage`, 403 `forbidden`; MFA by content).
2. `requireFeature("settings.import")` → 404. On Undo, `ParseUUIDPipe` answers 400 for a malformed id before this.
3. Zod → 400.
4. `openKind`: a kind part 1 doesn't run → 404 "This kind of import is not available."; then `importKindRefusal`: module (403 `module_not_enabled` "This company does not have the module for this import."), the records' switch (404), data scope (403 "Importing needs company-wide data scope, because rows are matched against every record."), the kind's keys (403 "Your role can't see, add and change customers, so it can't import them.").
5. `mappingFor` and `importRequestProblem` → 400.
6. `openColumns` → 403 "Your role can't see credit limit, so leave the Credit limit column out." (or cost).
7. The import and Undo: `StepUpService.require` → 403 `step_up_required` or `step_up_mfa_required`.
8. The transaction.

Undo takes the step-up first; inside its transaction it reads the batch (404, then 409 `already_undone`) before steps 4 and 6, which it runs on the batch's stored kind and mapping, since Undo puts sensitive values back. Saving columns runs steps 1 to 4 and `mappingFor`; header names need no sensitive key and no step-up.

`importFailure` reads the PostgreSQL code of the error or of the error it wraps: 40P01, 40001 or 55P03 → 409 `import_busy` "The records were busy, so nothing was imported. Try again in a moment."; 23505 → 409 `import_conflict` "A record in this file clashes with one saved at the same time, so nothing was imported. Check the file again."; refusals pass as they are; anything else is rethrown for the ErrorFilter (a 500 it logs), since the field rules keep data errors from reaching the database.

#### 4.5 Dry run and commit
Both plan with the shared `planImport` against the records as the modules' loaders read them, with the company's `today` and `now` (its local minute, `minuteIn`) from `companyClock`.

**Dry run:** one `REPEATABLE READ, READ ONLY` transaction, so the loaders read one snapshot. It takes the import lock without waiting (409 `import_running` "Another import or undo is running for this company. Try again when it finishes."), plans under batch "this import", and answers `{ rows, counts }`. No table lock, no write, no audit entry.

**Import,** one READ COMMITTED transaction; all valid rows commit or none do:
1. the import lock: `pg_try_advisory_xact_lock(hashtext('imports:run'))` in the company's own database (409 `import_running`);
2. `set local lock_timeout = '10s'` (table locks and the stock lock);
3. 50 or more batches in the last 24 hours, deleted ones included → 429 `rate_limited` "Your company has imported 50 files in the last 24 hours. Try again later.";
4. the kind's table locks (4.7);
5. the next number, `IMP-1001` upward, read over every batch, deleted ones included (the unique index isn't partial), and a UUID v7 id;
6. the plan again, against the records as they are now, never the screen's copy;
7. `planActions(rows) !== expected` → 409 `plan_changed` "The records changed since you checked this file. Check it again before importing." A repeated import is safe too: after a success the same file plans to all skips;
8. nothing to create or update → 400 "Nothing to import: every row is skipped or has errors.";
9. each change through the kind's row functions, in plan order;
10. each change read back through its module's loader, so the batch keeps the canonical version (decimals as stored, ids, addresses) for Undo;
11. the per-record audit entries, the `import_jobs` row, then the batch entry;
12. the answer `{ batch, rows }`.

#### 4.6 Undo
One transaction after the step-up: the import lock, the lock timeout, then:
1. the batch, live, `for update`: missing or deleted → 404 "This import no longer exists." (another company's batch is simply not in this database);
2. undone → 409 `already_undone` "IMP-1001 was already undone.";
3. the kind and the stored mapping (4.4 steps 4 and 6);
4. the kind's table locks;
5. **the rows it will soft-delete,** every created record and created part, `SELECT … FOR UPDATE` in a fixed table order and by id (`lockTargets`, chunked like the reference check). The table locks let a foreign-key insert elsewhere through, and that insert's check holds `FOR KEY SHARE` on the row it names until it commits; `FOR UPDATE` waits for it, so a quote or order line still being saved for a created customer or product commits first and step 8 sees it. The wait counts against the lock timeout (409 `import_busy`). Only the batch's own rows are locked, so writes naming other records never wait;
6. **unchanged:** each record read now through its module's loader must equal the batch's `after` (`sameRecord`), else 409 `import_changed` "Maple Row Builders changed after the import, so the import cannot be undone." A soft delete, an edit through the module (one address added or removed included), a later import or a new loader field all count;
7. **the kind's own rule** (products, section 7) → 409 `import_in_use`;
8. **references** (4.8) → 409 `import_in_use` "… is already used by other records, so the import cannot be undone.";
9. in reverse plan order: a created record is soft-deleted with its created parts, an updated one gets its `before` columns back, each with its audit entry;
10. `undone_at` and `undone_by`, the "Undid import" entry, and the summary as the answer.

Undo is all or nothing. In practice batches undo newest first, because a later import makes an earlier batch's records differ from its `after`.

#### 4.7 Kind stores
Each store has `lock`, `world`, `write`, `current`, `createdParts`, `undoProblem`, `undo` and the audit `shape`. Writes go through **row functions** (`customerRow`, `addressRow`, `supplierRow`, `contactRow`, `productRow`), the only place a shared record becomes a row. Each lists exactly the columns the import may change, turns `""` into null for uuid references (the loaders turn a null id into `""`) and `undefined` into null (M2). An empty external ID is stored as null. The import never calls the module services, which open their own transactions and don't write credit limit, rep, external ID, categories or products; it reuses their loaders, audit shapes, `contactProblem` and `lockStock`.

- **Customers and addresses:** `lock table addresses, customers in share row exclusive mode` (the order `saveCustomer` touches them). A new customer gets `taxExempt` false and `lifecycle` "customer"; an update inserts new addresses, updates changed ones, never deletes one; `county`, `lat` and `lng` are never written.
- **Suppliers:** `lock table suppliers, supplier_contacts in share row exclusive mode`. A new supplier is `active`, `track1099` false, `taxForm` null, notes empty; its contact (new suppliers only) passes the module's `contactProblem`, prefers email when there is one, else a call (R3). An import that would change an existing contact stops with an error; the kind never does that.
- **Products:** `lockStock`, then `lock table products in share row exclusive mode`, the order receipts use, so there is no cycle. `world` reads the retired SKUs and the products with stock history as SQL sets (`select product_id from stock_movements union select product_id from rolls`), not every movement and roll (M7). A new product gets the swatch `#A39A8E` and empty attributes; `externalId` is never written.

**Why table locks (S3 variant):** `SHARE ROW EXCLUSIVE` conflicts with every insert, update and delete on those tables, so module edits wait for the import or Undo and no concurrent create slips past the plan; it doesn't conflict with the `FOR KEY SHARE` locks of foreign-key checks, so quotes, invoices, orders and movements naming a customer or product don't wait; and an import writes no row locks. Undo adds `FOR UPDATE` on the rows it will soft-delete (4.6 step 5), which does conflict with those `FOR KEY SHARE` locks, so only a writer naming one of the batch's own records waits, or makes the Undo wait. A writer that takes the tables in the other order meets a deadlock, which becomes 409 `import_busy`.

#### 4.8 Reference check
Targets are every created record and every created part (an address on an updated customer). The foreign keys pointing at `customers`, `addresses`, `suppliers`, `supplier_contacts` or `products` are read from the catalog, so a table added later is covered without a code change; a foreign key of more than one column stops the Undo with a 500 the tests would catch. Links no foreign key covers are listed in `POLYMORPHIC_REFERENCES`: `meeting_attendees.party_id`, `attachments.owner_id`, `journal_entries.source_id`, and `outbox_messages.source_id` and `recipient_id` (text, R4).
- **Live rows only (M1):** a referencing row in a table with `deleted_at` counts only while that is null. Append-only tables (`journal_lines`, `stock_movements`) always count. Rows of the batch itself never count, so undoing addresses then customers, or products then suppliers, works. No code restores a soft-deleted row of a table that references these records, so ignoring soft-deleted rows is safe.
- **Copies are not references:** a quote's job-site JSON or a purchase order's contact snapshot doesn't stop an Undo. `audit_log.target_id` is a log and never blocks.

#### 4.9 Audit (rule 10)
Every entry is in category `data`, written through `AuditService.record` in the same transaction.

| When | Action | Target | Before | After |
| --- | --- | --- | --- | --- |
| Each created record | `Imported ${noun}` ("Imported customer", "Imported supplier contact") | `customer`, `supplier`, `supplier_contact` or `product`; id; name or SKU | null | the record's shape and `batch` |
| Each updated record | `Updated ${noun} by import` | same | the earlier shape | the new shape and `batch` |
| The batch | "Imported customers" (the spec's words per kind) | `import_job`; id; `${number}, ${fileName}` | null | the counts text |
| Undo, each created record | `Removed imported ${noun}` | same | the shape as imported | `{ batch }` |
| Undo, each updated record | `Restored ${noun} after undoing an import` | same | the shape as imported | the earlier shape and `batch` |
| Undo, the batch | "Undid import" | `import_job` | the counts text | "records put back as before the import" |
| Saved columns | "Saved import columns" | `import_mapping`; id; the kind's label | the earlier columns or null | the new columns |

The shapes follow the modules' own audit shapes plus the fields the import writes (credit limit, rep, external ID, categories, cost). Credit limit and cost are stripped when the log is read without their key. The dry run and `GET /imports` write nothing.

#### 4.10 Saved columns
`insert … on conflict (kind) do update set columns, updated_at = now(), deleted_at = null` (the unique index is on `kind` and not partial), the audit entry, and `{ id, kind, columns, savedAt }` (`savedAt` is `updated_at`; `savedBy` is gone). `created_by` keeps the first saver.

#### 4.11 Refusals
All through the one ErrorFilter body `{ code, message }`; the full table is in docs/api-contract.md.

#### 4.12 Route inventories
`isolation.int.test.ts` (401 without a session, 403 `company_required` without an open company) and `permissions.int.test.ts` (a declared permission on every route) pick up the five routes with no edit.

### 5. Web and demo

#### 5.1 Contract
`ImportOverview`, `ImportPreview`, `ImportResult`, `ImportBatchSummary` and `ImportMapping` come from packages/shared, so the history and the answers can't carry `changes` or `savedBy`. The notes on `runImport` and `undoImport` mention `expected` and the step-up.

#### 5.2 ApiClient
`importOverview` (`GET /imports`), `previewImport` (`POST /imports/check`), `runImport` (`POST /imports`, with `expected`), `undoImport` (`POST /imports/:id/undo`) and `saveImportMapping` (`PUT /imports/mappings/:kind`) are in `API_METHODS`, in their own block. `importBody` rebuilds each request: the kind, the file name, only the chosen columns in field order with every row, the kind's own mapping keys, and `expected` on an import; never a company id. A body over 100,000 UTF-8 bytes is refused before sending with "This file is too large to send in one go. Split it into smaller files and import them one by one." A batch id that isn't a UUID is refused with "This import no longer exists." and nothing is sent. Writes go through `wrote`, so the history and the record lists read again. `testDatabaseConnection` stays on the demo.

#### 5.3 DemoStore parity
`import-actions.ts` runs the API's checks in the API's order: the kind (module, switch, company-wide scope, the kind's keys), the column choices, the size limits, then the sensitive columns. The overview offers only the kinds the person may import; batches leave out `changes`; `runImport` refuses a stale `expected` and answers with the summary. Undo also needs the import's access (the kind and the stored mapping), compares with `sameRecord`, runs `productUndoProblem`, and takes its words from shared. Saving columns needs the kind open, refuses unknown fields and is audited. A signed-in person's holder is their effective access (View as included); the demo's platform admin gets `FULL_IMPORT_HOLDER`. The demo still removes records (it has no soft delete), keeps its text search for references, never retires a SKU, and writes one entry per batch, not per record.

#### 5.4 Screens (`apps/web/src/features/import`)
- **Import:** "Import N rows" opens the step-up, then sends the dry run's action per row as `expected`. Focus goes back to the Import button when the step-up is cancelled or refused. If saving the columns fails after a good import, the wizard says "The import worked, but the columns were not saved." and still shows the result.
- **Undo:** "Undo import" closes the question and opens the step-up ("Undoing IMP-…"), which then runs the Undo (the role editor's pattern).
- **Columns:** sensitive columns the person can't use are never chosen automatically (S-20). `ImportWorkspace` takes the person's access as a prop: Settings passes the workspace access, the demo-only platform-admin page `FULL_IMPORT_HOLDER` (`useCan` would throw there, as it has no workspace).
- **Kinds:** with none open, "Nothing can be imported here yet." (an HR Suite company in api mode, or a role with no kind open).
- **Files the wizard writes** (templates and the error report) go through `writeImportFile`: a cell that starts with `=`, `+`, `-`, `@`, a tab or a carriage return gets a leading `'` (`csvText`, `FORMULA_START`). HR's timesheet templates and the pay-period export, which payroll software reads, keep their cells as they are (`writeTableFile`).

### 6. Fields only the import writes (M5)
The import is the first writer of these fields, so there are no module rules to copy. Each is approved by the spec line given.

| Record | Field | Approval | Rule here |
| --- | --- | --- | --- |
| Customer | `creditLimit` | sales.md:742 "The credit limit comes from the seed or an import" | money of at most 10 whole digits; chosen only with `customers.customer.view_sensitive` (S-4) |
| Customer | `salesRepId` | import.md:312 (Sales rep; "New default is the importer") | an active company member (S-8), matched by email or name, ambiguous refused (S-16). A rep moves the customer's "own" data scope and the branch of future invoices, so importing needs scope `all` (S-2) |
| Customer | `externalId` | import.md:304; ADR 0019 "Matching" | at most 100 characters; ambiguous refused |
| Supplier | `categories` | import.md:337 | catalog values, compared as a set, written in catalog order |
| Supplier | `externalId` | import.md:328; ADR 0019 | at most 100 characters |
| Product | every field | inventory.md:509; ADR 0035 | section 7 |

### 7. Product rules (S-5, S-6, S-18)
- **Stock history freezes valuation (S-5, M4).** Once a product has any stock history (any stock movement, or any roll, soft-deleted rolls included), an import can't change its cost, category, selling unit, coverage or roll width, and Undo can't put them back. A transfer's `transfer_out` movement counts, so stock in transit does. Cost then follows receipts and average cost, as the inventory module keeps it.
- **Retired SKUs (S-6):** a SKU held by a deleted product (an undone import included) is a row error, "SKU “…” belonged to a deleted product. Use another SKU.", because `products_sku_uidx` is not partial.
- **Numbers (S-18, M3):** sq ft per carton and roll width more than 0, at most 10 whole digits and 3 decimals; reorder point whole, at most 10 digits; a price or cost converted from sq yd or cartons must still fit `numeric(14,4)`; never negative. A stored coverage of 0 counts as missing, so nothing divides by it.
- **Units:** cartons need coverage in every category, adhesives and trims included (the spec let them through with the price left per carton); carpet needs a roll width.
- **Text:** SKU at most 64 characters, name 200, brand, collection and color 100, supplier 320.
- **Supplier:** must match exactly one supplier (S-16).
- **Undo (M6):** an updated product can't be put back when its earlier supplier is no longer live, "Q's earlier supplier was removed, so the import cannot be undone.", or (S-5) when it has stock history now and the import changed its valuation fields, "… has stock history now, so its cost, category, selling unit, coverage and roll width can't be put back.". Both checks are the shared `productUndoProblem`; the API reads the stock facts once per batch.

### 8. The week-19 gate, part 1
`imports.int.test.ts` I-27 builds Summit's four files from `packages/shared/fixtures/summit.json` (`test/support/summit-tables.ts`) and imports them through the dry run and the import into a fresh company: 26 suppliers (with 24 primary contacts), 120 products (prices and costs equal the fixture as decimals), 80 customers and 118 addresses. A second run of each file is all skips, and undoing the four batches newest first leaves no live customer, address, supplier, contact or product. Customers and suppliers use their fixture ids as External ID. The sales rep column is left out (Summit's reps don't exist in a fresh company), and so is the reorder point column (owner question 13). Stock, open invoices and bills and employees, the other half of the gate, wait for their parts.

## Safest options taken (also in docs/blueprint-delta.md and the spec)
1. **S-1. Part 1 only:** customers, addresses, suppliers and products. Stock, open invoices and bills, employees, timesheets in the wizard, the platform-admin path and Connect a database wait (later parts). The API answers 404 for the other kinds.
2. **S-2. Company-wide data scope.** Matching reads every record (anything narrower would be an existence oracle), and a row may set another rep, which moves the customer's "own" scope.
3. **S-3. The kind's own keys,** on top of `settings.import.manage`: the view, create and edit keys of the records' module, plus `purchasing.supplier.view` and `inventory.product.view_sensitive` for products. Nobody grants more than they hold. The demo applies the same rule.
4. **S-4. Sensitive columns:** a chosen credit limit or cost needs the key that reveals it. A supplier's credit limit needs both the customer-credit key the response filter strips it with and a supplier-money key the purchasing routes use. Undo checks the batch's mapping too.
5. **S-5. Stock history freezes cost and stock fields** (section 7).
6. **S-6. Retired SKUs are refused** (section 7). The owner can approve a partial index.
7. **S-7. A step-up for the import and for Undo.** `MFA_REQUIRED_KEYS` is unchanged, since an auth change is the owner's.
8. **S-8. Active members only** as a customer's sales rep.
9. **S-9. The strictest terms:** a new supplier without Terms pays on order (the purchasing module's default; the spec said Net 30). A new customer gets Due on receipt, as the spec says, never the company default, which may be looser (the sales module uses it, R5).
10. **S-10. What you saw is what you get:** the import plans again under locks and is refused if any row's action differs from the dry run, order included. All valid rows commit in one transaction or none do; error rows are left out, as the spec says.
11. **S-11. Re-imports are idempotent:** decimals compare as decimals ("3.40" against a stored "3.4000" is a skip), a supplier address by its four fields, categories as a set, records by content. A second import of the same file skips on the API too.
12. **S-12. Limits:** only chosen columns are sent; 2,000 rows, 60 columns, cells of at most 1,000 characters, headers and file names of at most 200, each module's field lengths, digit caps on numbers and 10 whole digits on money; a request of at most 100 KB (the body limit is unchanged); one import operation (dry run, import or Undo) at a time per company; 50 imports per 24 hours; a 10-second lock timeout. A customer keeps at most 50 addresses, as the sales route allows.
13. **S-13. More audit:** one entry per record plus the batch entry, and saved columns are audited (the spec wrote none).
14. **S-14. Undo stays exact:** it compares each record with its module loader's version and is refused on any difference; it is refused while a live record points at one it created (catalog foreign keys plus meeting guests, attachments, journal sources and outbox rows); it is refused when a reference it would put back is gone; created records are soft-deleted, never removed.
15. **S-15. Nothing leaves that needn't:** batches never send `changes`, and `savedBy` is dropped; answers carry `Cache-Control: private, no-store`; the file is parsed only in the browser and never stored, and only its chosen columns travel; the CSVs the wizard writes neutralise formula cells.
16. **S-16. Ambiguous keys are refused:** an External ID, email, name or SKU that matches more than one record is a row error, never "the first one".
17. **S-17. Hidden control characters are refused** in cells (except tab and line breaks in a timesheet note), headers, file names and column choices.
18. **S-18. Product rules** (section 7).
19. **S-19. Blank means blank in the chosen columns:** a row with nothing in any chosen column is left out, in both modes.
20. **S-20. Sensitive columns are never chosen automatically** for someone who can't use them.

**Also safer, settled while building:**
- **Emails match exactly, ignoring case only.** Folding would treat "j-smith@" and "j_smith@" as one person and update the wrong customer. External IDs and names still fold (spec rule 8 narrowed for emails).
- **`GET /imports` lists saved column choices only for the kinds the person may import.**
- **Undo in the demo needs the import's access too** (the kind and the stored mapping), and runs the same product check as the API.
- **The demo hides kinds whose switch is off,** for the platform admin too (CLAUDE.md rule 13); `importKindsFor` never did.
- **Saved columns in the demo** need the kind open, refuse unknown fields and are audited.
- **The formula escape is anchored at the start of the cell** (`/^[=+\-@\t\r]/`), not Papa Parse's own pattern (`/^[=+\-@\t\r].*$/`), which misses a cell holding a line break; the error report repeats file values as they were.
- **An empty external ID is never stored;** a mapping key with a control character or over 60 characters, and a `__proto__` key, are refused.

## Review items
The plan was checked by a critic before the build; code comments cite these items.
- **M1** live references only (4.8); **M2** row functions (4.7); **M3** digit caps and conversions that fit (section 7); **M4** stock history freezes valuation (S-5); **M5** the import is the first writer (section 6); **M6** a product Undo needs its earlier supplier live; **M7** linear planning (section 3, 4.7).
- **R1** the dry run reads one `REPEATABLE READ, READ ONLY` snapshot; **R2** `requireFeature`, `companyClock` and `loadNames` reused, step-up helpers local to the test; **R3** a new supplier contact passes the module's `contactProblem`; **R4** the outbox's `source_id` and `recipient_id` are references; **R5** a new customer gets Due on receipt, not the company default.
- **S14, not taken:** escaping formula cells in the app-wide `data-table/csv.ts`. It serves every list export and needs its own rule for negative numbers (Papa Parse's escape turns `-12.50` into `'-12.50`). The exposure isn't new: names already enter as free text through the sales and purchasing modules. It stays open (owner question 11).

## Kept as the spec says (not safety)
- Error rows are left out and the rest import (rule 6); an empty cell never clears a field (rule 7).
- Matching by External ID, then email, then name; a supplier is matched on its first non-empty key, so an External ID that matches nothing makes a new supplier; a contact is added only to a new supplier; tax exemption and certificates are not imported.
- Batch numbers `IMP-1001` upward; the batch audit words; the dry run writes no audit entry; the error report appears only after an import.
- New customers: Due on receipt, credit limit `0.00`, the importer as rep. sq yd and carton prices are converted to sq ft (rule 9) and cut to 4 places.

## Smaller choices made while building (not safety)
- `canonical.ts` holds the content comparison on its own, and `kind-stores.ts` the store registry, to avoid import cycles.
- Saved-column audit entries keep the column objects on the API; the demo writes a text summary, so the two modes word that entry differently.
- The product Undo check reads the stock facts once per batch.
- The contract types moved to packages/shared in the demo stage, because `DemoStore implements ApiClient` wouldn't compile with the old types.
- The demo keeps `expected` optional (an empty string fails the comparison); the API requires it.
- Request methods throw inside the promise, so a too-large body rejects rather than throwing at once.
- The SR-22 example used coverage `0.0001`, which the 3-decimal coverage refuses; the test checks that refusal and uses `0.001`.
- A row-limit message prints the raw count: "This file has 2001 rows. Import up to 2,000 at a time; split the file."
- An addresses row without an Address type keeps the stored label of the address at its street and ZIP (rule 7); only a new address defaults to a job site, so a file without that column skips a billing address "Already on file." (final review).

## Later parts (not built here)

| Part | What | What it needs first |
| --- | --- | --- |
| 2. HR | `employees` (with the PTO opening balance); `timesheets` in the wizard with batches and Undo | `PeopleService.save` split into a `saveIn(tx, …)` the route and the import share (payroll lock, self-edit refusals, commission and manager checks, manager history, onboarding checklist, California salary hours, never logging the rate). Pay rate only with `hr.employee.view_sensitive` (already a kind key). PTO through the time-off adjustment rules. Timesheet weeks through `TimesheetsService`'s locks, refused in closed pay periods. Owner: may the import set pay rates at all? |
| 3. Opening stock | `stock`: rolls at their cost per sq ft; boxed counts as `opening` movements | One opening-balance journal entry per batch through `LedgerService` (Dr Inventory, Cr an opening-balance equity account) under `lockStock`, only for products with no stock history. Undo posts the reversal and is refused once a roll is cut or reserved or a movement follows. Owner and accountant: the equity account, the go-live date, the period |
| 4. Open invoices and bills | `invoices`, `bills` | An opening event per document (Dr AR / Cr opening equity; Dr opening equity / Cr AP), never Sales or COGS; how reports, commissions and margin treat opening invoices; numbers against the company sequence; probably an `opening` marker (a migration); blueprint p54's import review and sign-off before go-live |
| 5. Platform-admin path | Import into another company from Platform admin → Company | Use of a support grant (ADR 0052 owner question 2; ADR 0054 question 33). A TenantContext from a grant is core/tenancy, so the owner decides. Until then `/admin/companies/*/import` stays "not found" in api mode |
| 6. Portal timesheet uploads | Upload own hours | Already on the API (`POST /timesheets/upload`, ADR 0046). Part 2 may give it a batch |
| 7. Connect a database | Real connectors | Approval of docs/specs/data-integration.md; drivers (new dependencies) through packages/providers (rule 11); encrypted credentials; egress limits; a pg-boss schedule |
| 8. Schema and module follow-ups | | Partial unique indexes `where deleted_at is null` on `products.sku` (and `rolls.roll_number`, `invoices.number`); an index on `import_jobs (created_at)`; a larger body limit for `/imports` (`app.ts`); module writers that reference customers, suppliers or products take `FOR SHARE` on the parent and re-check `deleted_at`; a daily cap on dry runs |

## For the owner
Also in docs/product-spec/import.md, "Real build (ADR 0057)", and the session log.
1. **MFA (S-7).** Add `settings.import.manage` to `MFA_REQUIRED_KEYS` (STATUS, third review)? Meanwhile the import and Undo need a step-up.
2. **Request size (S-12).** Raise the limit for `/imports` from 100 KB (about 600 to 1,500 rows of chosen columns) to 1 MB in `app.ts`, like the proof routes? Meanwhile larger files are split.
3. **Retired SKUs (S-6).** Partial unique indexes on `products.sku` (and roll and invoice numbers) `where deleted_at is null` (a migration), so an undone import frees its SKUs?
4. **Opening balances (parts 3 and 4):** one entry per document or one summary entry; Owner's Equity or a new Opening Balance Equity account; the go-live date and period; an `opening` marker on invoices and bills (a migration); whether opening invoices count in reports and commissions; the review report and sign-off before go-live (blueprint p54).
5. **Opening stock** only for products with no stock history, with later counts through Correct stock count?
6. **Employees (part 2):** may an import set pay rates at all, and should each imported person need an HR confirmation?
7. **Platform-admin imports:** use of a support grant (ADR 0052 question 2).
8. **Connect a database:** approve docs/specs/data-integration.md before any connector.
9. **Confirm** S-2, S-3, S-5, S-9, the limits of S-12, S-16 (exact emails included) and S-19.
10. **The Undo race:** Undo's `FOR UPDATE` on the rows it removes (4.6 step 5, final review) now closes an insert already in flight: the Undo waits for it and then refuses. Still open: a module writer that read the record as live before the Undo committed and inserts its reference after, since a foreign key doesn't check `deleted_at`, and a polymorphic link (a meeting guest, an attachment, an outbox row), which takes no lock on the record at all. The follow-up: module writers that reference customers, suppliers or products (quotes, invoices, orders, meetings, contracts, `saveCustomer`, `saveContact`) take `FOR SHARE` on the parent and re-check `deleted_at` before writing. A follow-up across modules.
11. **CSV exports app-wide:** escape formula cells in `data-table/csv.ts` and the Business report, with a rule that leaves plain negative numbers alone? The same question for HR's timesheet templates and the pay-period export, which payroll software reads and which this build left as they were.
12. **Dry runs:** a daily cap needs a table or an audit row per dry run (the spec says a dry run writes none). Accept size, linear planning and one at a time per company as the bound?
13. **Reorder point.** import.md:357 makes it a whole number, while inventory.md:326 keeps it in sq ft for boxed goods, and Summit's fixture holds values such as 686.4. The import keeps the whole-number rule (a fraction is a row error). Which is right?

## Residual risks
- **Write pause.** An import or Undo blocks writes to the tables it locks for its few seconds: customers and addresses, or suppliers and contacts, or products plus the stock lock. A 2,000-record import makes about 4,000 to 6,000 statements, because audit entries go one by one. Foreign-key inserts elsewhere don't wait. The import gives up after 10 s with a 409.
- **Undo race.** An insert already in flight when the Undo starts is closed: Undo locks the rows it removes `FOR UPDATE`, waits for the insert's foreign-key lock and then sees the new reference (4.6 step 5). Still open: a module write that read a record as live before the Undo committed and inserts its reference after, because a foreign key doesn't check `deleted_at`, and a polymorphic link, which takes no lock on the record. The window is the Undo's transaction (owner question 10).
- **Reference coverage.** The check trusts foreign keys plus a short list; a future polymorphic link must be added to `POLYMORPHIC_REFERENCES`.
- **Soft-deleted rows stay.** An undone import leaves soft-deleted rows and retires its SKUs. The demo removes records instead.
- **Sensitive values at rest.** `import_jobs.changes` keeps full before and after versions, credit limits and costs included, in the company database. They are never sent out.
- **Dry runs** have no daily cap; they are bounded by size, linear planning and one at a time per company. `import_jobs` has no `created_at` index for the daily count (a small table).
- **413 body.** A body over 100 KB that skips the web's check gets the body parser's own 413, not the JSON error body.
- **Ambiguity refusals.** Real data with shared emails or names needs External IDs before it can import.
- **Seeded stock.** In a seeded company the seeded products have stock history, so an import can't change their cost or unit (S-5).
- **Demo and API differ on purpose** in four places: soft delete against removal, the retired-SKU refusal (the demo never retires), per-record audit entries, and the wording of the saved-columns entry.
- **JS numbers.** `widthFt` and `reorderPoint` travel as JS numbers in the shared `Product` type (existing); they are exact within the digit caps.
- **Undo dialog words.** It says records the import created "are removed"; on the API they are soft-deleted, which the person sees as removed.
- **Test database rows.** Each api-mode e2e run leaves two soft-deleted customers, an undone batch, one saved customers-columns row and their audit rows on the throwaway database, and counts toward Summit's 50 imports a day there.
- **Gate coverage.** Part 1 covers the master-data half of the week-19 gate.

## Consequences
- **No schema, dependency or core change:** no table, column, index or migration; no dependency; nothing in `apps/api/src/core`, `packages/db`, `features.ts` or `app.ts`. docs/FEATURES.md changes notes only (no status, key or screen path).
- **Changed behaviour, in both modes:**
  - importing needs company-wide scope and the kind's keys, and a chosen sensitive column its key; the demo's overview offers only the kinds the person may import;
  - the import and Undo ask for a step-up;
  - ambiguous keys, control characters and over-long or over-precise values are row errors; emails match exactly;
  - a new supplier without terms pays on order; carton adhesives and trims need coverage;
  - rows blank in every chosen column are left out; HR's `POST /timesheets/upload` also refuses control characters and leaves those rows out;
  - the wizard's CSVs escape formula cells.
- **Paths touched:** `packages/shared/src/import/` (`access`, `limits`, `lookups`, `canonical` and `undo` new; `types`, `fields`, `lookup`, `plan`, `mapping`, `index` and the kinds changed); `apps/api/src/modules/imports/*` and one import in `app.module.ts`; `sales/sales-records.ts`, `sales/sales.service.ts`, `purchasing/purchasing-records.ts`, `purchasing/purchasing.service.ts` (moved audit shapes); `apps/web/src/lib/api/` (`contract.ts`, `http/api-methods.ts`, `http/import-body.ts`, `demo/import-actions.ts`, `demo/store.ts`); `apps/web/src/features/import/*` and the admin import page's comment.
- **The docs changed:** docs/api-contract.md, docs/product-spec/import.md ("Real build (ADR 0057)"), docs/data-model.md, docs/blueprint-delta.md and docs/FEATURES.md (notes).
- **Tests:**
  - packages/shared: new `import-rules.test.ts` (35 cases: SR-1 to SR-29, with a linear-planning timing test); `import.test.ts` (25) unchanged and passing. The package: 1,044 cases in 70 files.
  - apps/api: new unit `import-input.test.ts` and `import-rows.test.ts` (26 cases: U-1 to U-6, the stores, audit words, summaries and access); the API unit suite is 122 cases in 17 files. New `imports.int.test.ts` (34 cases: I-1 to I-33 and the history order) with `support/summit-tables.ts`. With `isolation`, `permissions`, `sales`, `purchasing`, `inventory`, `hr` and `portal`: 152 cases in 8 files.
  - apps/web: new unit `demo-import.test.ts` (8: D-1 to D-3 and more), `imports-api.test.ts` (9: W-1 to W-6 and more) and `csv-text.test.ts` (3: W-7 and more); the web unit suite is 229 cases in 25 files. Demo `tests/e2e/import.spec.ts` gains the step-up and a formula cell in the error report; new api-mode `tests/e2e-api/import.spec.ts` (the Owner's four kinds, a dry run, an import, a re-import that skips, the history and Undo, each with a step-up).
  - Runs before the docs stage: demo e2e flooring project (`import`, `a11y`, `responsive`) 193 passed, hr `import` 1 passed; the api-mode import spec twice in a row on the same database, then the whole api-mode suite, 27 of 27. Mutation checks (one protection removed at a time, then restored) made tests fail each time: emails folding, the stock-history freeze, control characters, blank rows, ambiguous keys, stored decimals, the contact copy, the sensitive-column check, `expected`, the summary, the demo's Undo access, the holder on kinds, Undo counting deleted references, an empty rep id, no dry-run lock, no "changed since" check, no earlier-supplier check, Papa's default escape pattern, no byte limit, no saved-id guard and formula escaping in the error report.
