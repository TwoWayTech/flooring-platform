# Session 2026-11-14 13:00, A (Claude): contracts part 1, the register

The owner's queue of 2026-11-14, task 5 (docs/real-build-plan.md week 10). Branch `feat/contracts-register`, from main at `34471ea` (PR #22 merged as `069ccb3`).

## Read first
docs/product-spec/contracts.md (all of it), the demo's contract-actions.ts, packages/shared/src/contracts, ADRs 0038 to 0043.

## Plan
Contracts lands in two parts, like sales:
1. **This part (ADR 0044):** the register (draft, send, recall, simulated signature, complete, close, terminate, renew, files), lines, change orders, lien waivers and insurance on the API, with data scope by rep and branch; read-only billings; the seed (no billings); `contractsData()` for the contract screens.
2. **Part 2:** progress billings and retainage releases raising invoices or subcontract bills, with their postings and voids; the billing seed.

The build was handed to a general-purpose subagent with a full brief (CLAUDE.md rules, the spec, the patterns of the expenses and payables modules); reviews and tests below.

## Safest options taken (ADR 0044, blueprint-delta)
- **Scope:** waivers and certificates follow their contract's data scope.
- **Rep and branch:** a new contract's rep is always the creator, and its branch the creator's (company-wide scope may choose).
- **Customers:** a customer must be in the creator's scope.
- **Estimated cost:** it survives a save by someone without view_sensitive, or a save that leaves it out.
- **Signature:** no PDF on the API; a SHA-256 of the signed terms is kept.
- **Close:** it also counts unpaid subcontract bills.
- **Renew:** it makes a fresh draft.
- **Stricter checks than the demo:**
  - masters take no completion, change orders or waivers;
  - change-order rows name only their own contract's lines;
  - a waiver's payment must belong to the contract's party.

## Reviews
- **Test-writer:** 12 tests, no product bugs.
- **First security review:** 1 blocking, fixed. A change order with two rows on one line lost one when approved. Now rows on a line add up in both the check and the change, with a test.
  - Should-fix items done:
    - a new line needs an amount above zero (shared `changeOrderProblem`, tested);
    - change-order routes need the `contracts.billing` switch;
    - the signature hash covers every signed term, and its version counts the sends;
    - `GET /files/:id` accepts `contracts.contract.view`;
    - only a not-found lock error reads as 404.
  - Owner question, recorded in STATUS: the same person may submit and approve a change order (spec edge case 19).
- **Second security review:** 1 blocking, fixed. Estimated cost was kept by line code, and codes were not unique, so someone without view_sensitive could rename a costed line to drop its cost, or reuse a code to move it. Now each line needs its own code, and without view_sensitive a costed line may not lose its code (tests).
  - Should-fix items done: the web reads `/change-orders` as empty when billing is off (`seenOrOff`); a new change-order line at or below zero is refused on submit too; the save audit records each line's code and value (costs stay out).
- **Third security review:** see PR #23.

## Commands run and results
- `contracts.int.test.ts`: 13 of 13 after the second review. Full `pnpm test` and `pnpm test:api` before it: all pass (API 244, db 32, shared 378). `pnpm typecheck` and lint pass.
