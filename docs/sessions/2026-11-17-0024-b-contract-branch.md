# Session 2026-11-17 00:24, B (Claude): the contract form sends no branch, the server decides it (B4)

Person: B (Claude), on B's Mac. Branch `fix/contracts-branch-from-session`, base `7c4003e` (the head of B1's branch `fix/sales-quote-without-cost`, draft PR #46, itself stacked on B3's PR #45). Main is `d0e4e20` (B2 merged in PR #44). This is the main checkout. The paused whole-product check (`feat/check-whole-product`, draft PR #43) sits in its own worktree, `/Users/sarah/dev/flooring-platform-check`, and this branch never touches it. The draft PR is opened right after this log's first commit.

**Stacked on PR #46.** B3 (PR #45) and B1 (PR #46) can't merge yet: GitHub Actions is blocked by a billing problem on the account. To keep STATUS and BRANCHES linear, the orchestrator cut this branch from B1's head, so B2, B3 and B1 are all in its history. This PR must merge after #45 and #46 (D8).

## Prompt

### The owner's queue (verbatim)
> Queue change from the owner. After #41 and #42 are merged, do these before the whole-product check, each in its own small PR under the usual rules:
> 1. Bugs, in this order: B2 first (screens must refresh after a save, and My timesheet must never save old hours over an upload), then B3 (the stock panel's "Short by 0.00 ft"), then B1 (salesperson quote builder crash when cost is withheld; security review required), then B4 (branch-assigned users can't save a contract; security review required). After each fix, turn the matching e2e flow (F1, F2, F5) back on from fixme.
> 2. Move the remaining screens to the API: GET /company first (roles, modules and permission limits, so buttons match what the API allows), then Settings, the notification bell and the Outbox, stock adjustments, installation jobs, a trial balance screen, and the passkey screens with the QR code. Make today() use the company's time zone.
> 3. Then the whole-product check: compare every item in docs/product-spec/, docs/FEATURES.md and docs/demo-script.md with what runs on the real API, and write docs/real-build-coverage.md (done, partly done, missing). Add tests proving the trial balance always balances and that customer balances, supplier balances and stock value agree with the ledger. Add a permission-matrix test that calls every endpoint as every role and as another company's user. Create a fresh company with the setup script, import sample CSV data, and run docs/demo-script.md in api mode with Playwright. Fix what you find in small PRs.
> 4. Then stop and hand off. Don't start P13; the owner does a click-through first.

This session is item 1, the fourth bug: B4. B2 is in this branch's history (and B3 and B1 too), so F5 comes back from `fixme` here.

### Per-task rules (owner)
- Read the blueprint prompt first: P11 in docs/real-build-plan.md ("Each module follows prompt P11"), the product spec (docs/product-spec/contracts.md) and docs/real-build-plan.md.
- No plan mode. A short plan goes in this log.
- For anything open, pick the safest option and record it here under "Decisions and why". Add a docs/blueprint-delta.md row only if the plan of record changes.
- Follow `.claude/commands/feature.md`. Commit and push after every step.
- CLAUDE.md rules apply: rule 1 (screens only through the ApiClient), rule 2 (the company from the verified session), rule 3 (data scope on every endpoint), JSDoc on exports, no dead code, no duplicated logic.
- ADR numbers: 0058 is reserved by the paused check branch, so this work amends ADR 0044 with a dated section.
- STATUS and BRANCHES are left to the orchestrator's handoff; what they need is under "For STATUS" below.
- The plan's dates use a `<day>` placeholder; this session uses 2026-11-17.
- **This laptop (8 GB):**
  - Heavy commands (lint, typecheck, Vitest, builds, Playwright, `pnpm test:api`) run one at a time through the scratchpad lock.
  - Api-mode Playwright runs against the throwaway PostgreSQL on 5433. That container is never re-created, reseeded or stopped, and `docker compose up` or `stop` is never run.
  - The env files are never read, printed or created.
- **Git:**
  - Working commits carry `[skip ci]` and are pushed by naming the branch.
  - Never a bare push, a pull, a push to main, a merge, a `gh api` write, `gh pr ready`, `gh pr merge` or `rm -rf`.

### The bug as recorded (docs/STATUS.md, "Api-mode bugs the flows found", B4)
- Nobody with a branch can save a new contract in api mode. The form sends the DemoStore user's `branchId` (`"sm-br-denver"`), and `POST /contracts` answers 400 "Invalid UUID".
- The API files a new contract under its creator's branch anyway (`newBranch`), so the client should send none.
- It touches data scope, so it needs a security review. It goes with R1 (the shell's user is still DemoStore's). It blocks F5.

## Inputs
- **Plan and specs:**
  - docs/real-build-plan.md: P11 (a spec approved first, failing tests, schema and endpoints with guards, postings and audit, the screen on the API, a security review, a PR and the handoff) and the CI budget.
  - `.claude/commands/feature.md`.
  - docs/product-spec/contracts.md:148 (Steps 1, "Add a draft": "sales rep is the creator, branch is the creator's") and :362 (the `branchId` field: "The creator's branch. Sets branch data scope").
  - ADR 0044 "New contracts" (the rep is the creator, the branch the creator's; someone with no branch picks one only with scope `all`; an edit keeps both) and ADR 0051 R1 (the shell's keys, scope and user are DemoStore's in api mode until `GET /company` moves).
  - docs/api-contract.md, the `POST /contracts` row (`branchId?` only for someone with no branch and scope `all`).
- **Where the bug was found:**
  - docs/STATUS.md "Api-mode bugs the flows found" (B4) and "PR #42 final review notes" (a sent branch is ignored for anyone with one; F5 posts its customer inline instead of `postAs`).
  - The flows session log docs/sessions/2026-11-16-0200-b-e2e-api-flows.md: decisions 54 to 56, and run `f5-try1` (commands table), which failed at Save contract with this 400 and `"sm-br-denver"` in the body.
  - The B2 log docs/sessions/2026-11-16-1651-b-reread-after-write.md, lines 187-188 and run `b2-f5-var`: a throwaway F5 with only the POST body's `branchId` set to null passed every step in 10.1 s.
- **The code at `7c4003e`:**
  - **Web:** `features/contracts/contract-form-dialog.tsx` (the new draft takes `branchId: user.branchId` and `salesRepId: user.id` from `useWorkspace()`), `lib/api/http/api-methods.ts` (`saveContract`, `contractBody`, `isSaved`), `lib/api/contract.ts` (`ContractInput`), `lib/session/api-context.ts` (`toCompanySession`), `components/workspace/workspace-provider.tsx`, `lib/api/demo/contract-actions.ts`.
  - **API (read, not changed):** `modules/contracts/contracts.controller.ts` (`CONTRACT`, `.strict()`, `branchId: z.uuid().nullable().optional()`), `contracts.service.ts` (`save`, `newBranch`, `renewedTerms`), `core/access/access.service.ts` (branch and scope read on every request).
  - **Tests:** `apps/web/tests/unit/fake-api.ts`, `timesheets-api.test.ts`, `api-rereads.test.ts`; `apps/api/test/contracts.int.test.ts`; `apps/web/tests/e2e-api/flows/f5-contract-retainage.spec.ts`, `kit.ts`, `checks.ts`.
- **Planning:** a first plan, a critic's review (must-fix M1 and M2, should S1 to S11) and a final plan that applies them, each checked against the code. They live in the session scratchpad, not in the repo, so the plan is restated below.

## Plan (short)

### The fix (client only; one line removed)
- `contractBody` (`apps/web/src/lib/api/http/api-methods.ts`) stops sending `branchId`. It already leaves out `salesRepId`. Its JSDoc says the rep and the branch are the server's.
- The contract form gets a comment only: the demo files a new contract under `user.branchId`, the API under its creator's own, and is never sent one.
- Nothing else changes: not the API, DemoStore, the schema, the switches or the dependencies. `ContractInput` keeps `branchId` and `salesRepId`, because DemoStore's `saveContract` and `renewContract` read them.
- R1 is not touched. The contract path no longer depends on the shell user's branch, so it stays right before and after `GET /company` (queue task 2).

### Tests
- **Web unit test, red first** (`apps/web/tests/unit/contracts-api.test.ts`, new, on the `fakeApi` harness): the body carries no `branchId` or `salesRepId` for a new contract, for an edit, and for a branch that is a UUID.
- **API integration test** (`apps/api/test/contracts.int.test.ts`, one new `it`, last in the describe): pins the server rule the client now relies on. A creator with a branch always gets their own, whatever the body says and whatever their scope; an edit can't move it; a branchless creator below scope `all` can't pick; a branchless all-scope creator picks only a live branch of this company (unknown, soft-deleted and another company's ids are refused). Three mutations of `newBranch` prove it catches a break.
- **F5 back from `fixme`:** step 1 checks the sent body (no branch, no rep) and that the contract is filed under the Owner's API branch; its setup customer goes through `postAs`; two clean-ups void a stopped run's open billings, each refusal checked by message.

### Stages (one commit each, pushed)
| Stage (P11) | What |
| --- | --- |
| 0 (1: the spec holds) | This log; then the draft PR |
| 1 (2: tests) | The API integration test, with the mutations |
| 2 (2 and 4: red test, the screen's api path) | The web unit test (red first), the fix in `contractBody`, the form's comment |
| 3 (2: e2e) | F5 back from `fixme`, with clean-ups checked by message |
| 4 | ADR 0044, a dated section "The web leaves a new contract's branch to the API (2026-11-17, the flows' bug B4)" |
| 5 (5 and 6: review, PR, handoff) | Full checks, `/review`, a fresh read-only security review (data scope), the handoff |

P11 mapping: (1) the spec already says "branch is the creator's", so no spec change; (2) stage 2's red unit test, and stage 1's integration test pins the existing rule, proved by mutations; (3) no schema or endpoint changes; (4) the form's api path, `contractBody`; (5) a security review; (6) stage 5.

## Decisions and why
Planned decisions, each the safest option found. Decisions taken while building go under "Decisions taken during the build".

- **D1, send no branch, rather than only a UUID one** (an `isSaved` filter). Today the two behave the same, because the shell's branch is never a UUID. After R1 a UUID branch would be sent and then ignored for anyone who has one, so the filter buys nothing and keeps a client-chosen value on the wire. Sending nothing is simpler, and the server stays the only judge.
- **D2, no branch picker on the form.** The spec says the branch is the creator's and shows no picker. ADR 0044 lets a branchless creator with scope `all` send one, but no screen does, and under R1 the client can't know the API user's branch, so it couldn't tell when to show one. A picker is new UI and a spec change, so it is an owner question (Q-B4-1).
- **D3, no server change.** The API's rule is the decided one (ADR 0044) and already right. Defaulting a branchless Owner to some branch would be a new data-scope rule (Q-B4-1).
- **D4, no DemoStore change.** Demo mode never reaches `api-methods.ts` (`createApiClient` returns DemoStore when the data source is `demo`). The demo already gives the creator's branch. Taking it from the actor would also mean reworking `renewContract`, which passes the old contract's branch through `saveContract`: risk with no gain.
- **D5, never send `salesRepId`.** It is already left out; the unit test and F5 now pin it.
- **D6, amend ADR 0044 with a dated section.** No new ADR (0058 is reserved, and this is a client detail of 0044's own "New contracts" rule). No docs/blueprint-delta.md row: the plan of record doesn't change. No change to the spec, docs/api-contract.md, docs/FEATURES.md or docs/data-model.md.
- **D7, the test-writer subagent.** feature.md step 4 hands API and Playwright tests to test-writer. This session can't spawn subagents (as in B2 and B1), so the tests are written here from the plan's list.
- **D8, stacked on PR #46** (the orchestrator's decision, the safest option while CI is blocked by billing). The branch is cut from B1's head `7c4003e`, so B2, B3 and B1 are in its history and F5's run proves them too, and STATUS and BRANCHES stay linear. The PR must merge after #45 and #46. When they merge, the orchestrator merges `origin/main` into this branch.
- **D9, the names in the task win over the plan's.** This log is `docs/sessions/2026-11-17-0024-b-contract-branch.md` and the PR title is "fix(contracts): the contract form sends no branch, the server decides it (B4)", as the task gives them; the plan's own names were drafts.

### Decisions taken during the build

## Which test pins which path
| Path | Pinned by |
| --- | --- |
| The client never sends a branch or rep (create or edit, UUID or not) | `contracts-api.test.ts` cases 1 to 3; F5 step 1's request body |
| A creator with a branch always gets their own, whatever their scope | the new `it`, steps 1, 2 and 4; mutations (a) and (c) |
| An edit can't move the branch | the new `it`, step 2 |
| A branchless creator below scope `all` can't pick | the new `it`, step 5; mutation (b) |
| A branchless all-scope creator picks only a live branch of this company | the new `it`, step 3 (unknown, soft-deleted and another company's ids) |
| A new contract is saved from the screen in api mode, under the creator's branch | F5 step 1 |
| A stopped F5 run's open billing is voided | the `b4-f5-stop` throwaway run |
| A clean-up refused for an unexpected reason fails the run | `voidLeftBilling`; F5's finished runs |

## Owner questions
None blocks the build.

- **Q-B4-1, how does someone without a branch add a contract?** Today: the spec's "branch is the creator's", ADR 0044's server-side pick for scope `all`, and no picker. Options: (a) a branch picker on the contract form for all-scope creators (and for those who have a branch too?); (b) a branch required for everyone who may add contracts, plus a screen to set one; (c) the API defaults to the company's only branch. Taken until then: none of these; the API refuses in its own words. "Ask an Owner to set your branch" also reads oddly to an Owner.
- **Q-B4-2, the invite's branch in api mode.** The invite dialog's branches are DemoStore's, and `POST /users/invite` and `PATCH /users/:id` store an unknown branch as none, by design until Settings → Locations moves (`knownBranch`'s comment). Fix the dialog's branches with `GET /company` in task 2. Once the screens have the API's branches, should the API refuse an unknown branch (400) instead of storing none? Should the invite's audit row record the stored branch rather than the sent one?
- **Q1 of PR #42 (CI time)** stands, now with F5 in it.

## For STATUS
The orchestrator applies these at handoff (this session leaves docs/STATUS.md and docs/BRANCHES.md alone). Match by text, because B3 and B1 moved the lines. `#<n>` is this PR.

1. **"In progress".** After "B1 in draft PR #46, `fix/sales-quote-without-cost`, stacked on #45", record B4 in PR #<n> (`fix/contracts-branch-from-session`, stacked on #46).
2. **"Done":** a new top entry: **B4, a new contract's branch is left to the API,** PR #<n> (`fix/contracts-branch-from-session`, stacked on #46; this log; ADR 0044 "The web leaves a new contract's branch to the API"; no delta row). The contract form's body carries no `branchId` or `salesRepId`, so `POST /contracts` files a new contract under its creator's own branch (`newBranch`) instead of answering 400 "Invalid UUID" to DemoStore's branch id. The API is unchanged. A new integration test pins its rule: a sent branch is ignored for anyone with one, whatever their scope; a branchless creator picks a live branch of the company only with scope `all`; an edit keeps the branch. F5 runs (its local time), with two clean-ups (void the release, void Billing 1) whose refusals are checked by message. Checks: lint, typecheck, `pnpm test`, `pnpm test:api`, hooks, the api-mode suite (counts from the handoff).
3. **"Next three tasks", item 1.** B4 done in PR #<n>; "F5 needs B4" becomes "F5 runs since B4".
4. **"Api-mode bugs the flows found".**
   - Remove the B4 bullet (`- **B4, nobody with a branch can save a new contract in api mode:** …`).
   - In the header, "F5 waits on B4" becomes "F5 runs since B4 (PR #<n>)".
5. **"PR #42 final review notes".**
   - In the clean-ups bullet, "F5 registers none (`fixme`)" becomes "F5 registers two (void the release, void Billing 1), each refusal checked by message (`voidLeftBilling`)"; the "any 400 is done" gap stays for the other flows. F1's part stays as B1 left it.
   - In the "Nits" bullet, drop "F5 posts a customer inline instead of `postAs`" (done).
   - The B4 part of the bullet "B1, B4 and O2 were checked on the server" stays true; add "B4 fixed on the client in PR #<n> (no branch sent)".
6. **"Flows' local runs leave data".** Add: "F5 a completed contract with two paid invoices (Billing 1 and the release) and its customer; a stopped run's open billing is voided by its clean-up".
7. **The invite's branch, extending the existing note.** In "PR #11 security review", extend "In api mode the Users screen's branch picker still lists the demo's branches, so the API stores no branch for them until Settings → Locations moves." with: "The invite's audit row records the sent id (`"sm-br-denver"`) while the stored branch is null, and `PATCH /users/:id` drops an unknown branch the same way (`knownBranch`); such a person can't add a contract and, as a Manager, sees nothing branch-scoped (found while fixing B4)."
8. **A new follow-up bullet,** "**R1 symptoms found while fixing B4 (for `GET /company`, queue task 2):**":
   - the Users page's Branch column is blank in api mode;
   - a new quote's "sold at" defaults to the warehouse, not the rep's showroom (`quote-page.tsx`, showroom by `user.branchId`);
   - comparisons with `user.id` and `user.defaultLocationId` read DemoStore's ids;
   - `saveQuote` still sends DemoStore's `branchId` and `salesRepId`, which the API strips.
9. **"Blockers and open questions".** Add "Owner questions (PR #<n>, B4)" with Q-B4-1 and Q-B4-2. Append F5's measured time to PR #42's CI question (Q1).
10. **BRANCHES.** Add the row `fix/contracts-branch-from-session` | B (Claude) | B4: the contract form leaves a new contract's branch to the API; F5 runs (main checkout; stacked on #46) | Draft, then "Ready for merge once CI is green" | [#<n>](https://github.com/TwoWayTech/flooring-platform/pull/<n>) | see the branch. Move B3's and B1's rows to "Merged on …" once they merge.

## Commands run
Heavy runs go through the scratchpad lock. Logs are in the scratchpad's `b4/logs` folder, and api-mode runs in `flows/logs`.

| Stage | Command | Result |
| --- | --- | --- |
| 0 | `lsof` on 5432 and 5433 (read-only) | the compose PostgreSQL on 5432 and the api e2e one on 5433 are up |
