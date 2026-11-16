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

#### Stage 1 (the API integration test)
- **A third helper, `addBranch(companyId, values)`.** The plan inserts the soft-deleted branch and the other company's branch inline, each with its own open, insert and close. One helper beside `setBranch` and `withoutBranch` keeps that code in one place (CLAUDE.md: no duplicated logic).
- **The refusals go through a small `refused(who, body, message)` inside the case,** which checks 400 and the exact message, and `ownerCount()` counts the Owner's `GET /contracts`. Both live in the case, because no other case needs them.
- **The optional step 6 (DemoStore's `"sm-br-denver"`) is in.** It answers 400 "Invalid UUID", the zod message the flows' `f5-try1` saw, and adds nothing. It records why the client must never send DemoStore ids.
- **Step 1's three bodies are labelled** ("branch B sent", "null sent", "no branch key"), and step 4's check names the case, so a failure says which path broke.

#### Stage 2 (the red unit test and the fix)
- **The unit test checks the whole body for a create and an edit** (`toEqual` on one expected object), so a field dropped by mistake fails too, not only a branch that comes back. A readable `not.toHaveProperty("branchId")` comes first.
- **The edit and UUID cases send API-shaped ids** (a UUID branch and a UUID rep), the shape the shell will have after `GET /company`, so D1's "no filter" is pinned for both keys.
- **The withheld cost is an absent key,** made with `delete`, as `contracts.int.test.ts` does, because `ContractLine.estimatedCost` is typed as present.
- **`contractBody`'s JSDoc already cites ADR 0044's new section,** "The web leaves a new contract's branch to the API", which stage 4 adds (critic item M1: never cite a STATUS bullet the PR deletes).
- **No other place sends a contract's branch.** `saveContract` is called only from the contract form, renew has no body, and `api-methods.ts` names `branchId` nowhere after the fix.

#### Stage 3 (F5 back from `fixme`)
- **The kit still fits.** `kit.ts` and `checks.ts` export what F5 imports (`waitForAnswer`, `flowTest`, `choose`, `readAs`, `postAs`, …), `onCleanup` still takes `(label, () => Promise<APIResponse>)`, and B1 didn't change the settling rule ("any 400 or 409 is done"). B1's F1 clean-ups post inline, as before, so F5's `voidLeftBilling` is the plan's own.
- **`sentBody.catch(() => undefined)` is kept (critic item M2),** though B1's new `waitForRequest` in F1 has none. The plan's version is the safer one; F1's is a nit for STATUS.
- **A race in F5's own waits, found by the throwaway stop runs and fixed in F5.**
  - **What happened.** Two of the first four stop throwaways, `b4-f5-stop-release` and `b4-f5-stop-drop`, stopped early with "The contract page was not given billing N's invoice.", in steps 2 and 4. The clean-ups did the right thing both times.
  - **The cause, from the `drop` run's trace.** A write's re-read sends 24 GETs at once to the app ("Mark completed"'s, in the trace). Over HTTP/1.1 the browser runs only six at a time, so the rest queue. The contract page sends one `GET /invoices`, and two other readers on the page send one each. "Mark completed" hides once the page's own loader has all its answers, but the other two readers' answers can land later.
    - In the `drop` run, one of "Mark completed"'s three reads (260 rows, without the release invoice) got its answer at about 10173 ms. That is just after step 4 armed its wait, at about 10170 ms, and the click came about 55 ms later.
    - The kit's `waitForAnswer` takes any matching answer after it is armed, so it took that one.
    - The trace's per-request `time` leaves out the queueing, so on its face that read looked finished at about 10000 ms. A `response.text()` call at 10173.9 ms shows when its answer actually arrived.
  - **Not a product bug.** The screen shows the new billing and its invoice once its own re-read lands. Only the test's choice of answer was wrong.
  - **The fix: `nextInvoicesRead(page)`, local to F5,** for the two invoice re-reads (steps 2 and 4).
    - It records the `GET /invoices` requests the page sends after the wait is armed, and resolves to the first answer to one of them.
    - The contract page reads only on opening and after a write (`use-api.ts`: on mount, when its inputs change, and on `api.subscribe`). So between arming and the click nothing else is sent, and the first read sent after arming is the write's own re-read.
  - **Why not in the kit.** `waitForAnswer` is used by every flow, and some arm after the read may already be on its way (after a `goto`). A kit-wide "sent after arming" rule would need every call checked, and the plan keeps the kit unchanged for F5 (M2). F4's one re-read wait (`/me/portal`) is armed after `openMyPortal` has its answer and with no earlier write, so no re-read can be queued when it arms. This goes to STATUS as a follow-up.
  - **The proof, deterministic** (the `make-f5-race.py` throwaway):
    - Before step 4's waits are armed, the page sends its own `GET /invoices`. Its answer is fetched at once, so it predates the release, but it is handed to the page only once the release POST has been sent.
    - With step 4's old `waitForAnswer`, the run fails with exactly "The contract page was not given billing 2's invoice." (`b4-f5-race-old`).
    - With `nextInvoicesRead`, it passes (`b4-f5-race-new`).
  - **Re-run on the final F5:** runs 1 and 2 again (`b4-f5-c`, `b4-f5-d`), all four stop throwaways again (`b4-f5-stop2*`), and the whole suite.
- **The optional runs were done:**
  - stops after step 3 (`paid`) and after the release posted (`release`);
  - the S1 check (`drop`: "Only the latest billing can be voided." taken out of the set).
  - Each behaved as planned (Commands run). The optional pin (§6.3 run 5, the fix reverted) was not done: the red unit test and the flows log's `f5-try1` already show the bug, and it would cost two more builds on this laptop.
- **Demo e2e was run, although the plan says it isn't needed.** The task asks for it, so I took the safer reading: the demo contract specs, `contracts.spec.ts` and `flows-batch3.spec.ts` (whose flow 5 is G3-5), on a demo build. The demo build replaces the api build, so the final suite (`b4-all-final`) builds again.

## Which test pins which path
| Path | Pinned by |
| --- | --- |
| The client never sends a branch or rep (create or edit, UUID or not) | `contracts-api.test.ts` cases 1 to 3; F5 step 1's request body |
| A creator with a branch always gets their own, whatever their scope | the new `it`, steps 1, 2 and 4; mutations (a) and (c) |
| An edit can't move the branch | the new `it`, step 2 |
| A branchless creator below scope `all` can't pick | the new `it`, step 5; mutation (b) |
| A branchless all-scope creator picks only a live branch of this company | the new `it`, step 3 (unknown, soft-deleted and another company's ids) |
| A new contract is saved from the screen in api mode, under the creator's branch | F5 step 1 |
| A stopped F5 run's open billing is voided | the `b4-f5-stop` throwaway runs (after Billing 1, after its payment, after the release) |
| A clean-up refused for an unexpected reason fails the run | `voidLeftBilling`; F5's finished runs; the `drop` throwaway |
| F5 takes each new invoice from the write's own re-read, never from an earlier read still in flight | `nextInvoicesRead`; the `b4-f5-race-old` and `b4-f5-race-new` throwaway pair |

## Owner questions
None blocks the build.

- **Q-B4-1, how does someone without a branch add a contract?** Today: the spec's "branch is the creator's", ADR 0044's server-side pick for scope `all`, and no picker. Options: (a) a branch picker on the contract form for all-scope creators (and for those who have a branch too?); (b) a branch required for everyone who may add contracts, plus a screen to set one; (c) the API defaults to the company's only branch. Taken until then: none of these; the API refuses in its own words. "Ask an Owner to set your branch" also reads oddly to an Owner.
- **Q-B4-2, the invite's branch in api mode.** The invite dialog's branches are DemoStore's, and `POST /users/invite` and `PATCH /users/:id` store an unknown branch as none, by design until Settings → Locations moves (`knownBranch`'s comment). Fix the dialog's branches with `GET /company` in task 2. Once the screens have the API's branches, should the API refuse an unknown branch (400) instead of storing none? Should the invite's audit row record the stored branch rather than the sent one?
- **Q1 of PR #42 (CI time)** stands, now with F5 in it.

## For STATUS
The orchestrator applies these at handoff (this session leaves docs/STATUS.md and docs/BRANCHES.md alone). Match by text, because B3 and B1 moved the lines. This PR is #47.

1. **"In progress".** After "B1 in draft PR #46, `fix/sales-quote-without-cost`, stacked on #45", record B4 in PR #47 (`fix/contracts-branch-from-session`, stacked on #46).
2. **"Done":** a new top entry: **B4, a new contract's branch is left to the API,** PR #47 (`fix/contracts-branch-from-session`, stacked on #46; this log; ADR 0044 "The web leaves a new contract's branch to the API"; no delta row). The contract form's body carries no `branchId` or `salesRepId`, so `POST /contracts` files a new contract under its creator's own branch (`newBranch`) instead of answering 400 "Invalid UUID" to DemoStore's branch id. The API is unchanged. A new integration test pins its rule: a sent branch is ignored for anyone with one, whatever their scope; a branchless creator picks a live branch of the company only with scope `all`; an edit keeps the branch. F5 runs (its local time), with two clean-ups (void the release, void Billing 1) whose refusals are checked by message. Checks: lint, typecheck, `pnpm test`, `pnpm test:api`, hooks, the api-mode suite (counts from the handoff).
3. **"Next three tasks", item 1.** B4 done in PR #47; "F5 needs B4" becomes "F5 runs since B4".
4. **"Api-mode bugs the flows found".**
   - Remove the B4 bullet (`- **B4, nobody with a branch can save a new contract in api mode:** …`).
   - In the header, "F5 waits on B4" becomes "F5 runs since B4 (PR #47)".
5. **"PR #42 final review notes".**
   - In the clean-ups bullet, "F5 registers none (`fixme`)" becomes "F5 registers two (void the release, void Billing 1), each refusal checked by message (`voidLeftBilling`)"; the "any 400 is done" gap stays for the other flows. F1's part stays as B1 left it.
   - In the "Nits" bullet, drop "F5 posts a customer inline instead of `postAs`" (done).
   - The B4 part of the bullet "B1, B4 and O2 were checked on the server" stays true; add "B4 fixed on the client in PR #47 (no branch sent)".
6. **"Flows' local runs leave data".** Add: "F5 a completed contract with two paid invoices (Billing 1 and the release) and its customer; a stopped run's open billing is voided by its clean-up".
7. **The invite's branch, extending the existing note.** In "PR #11 security review", extend "In api mode the Users screen's branch picker still lists the demo's branches, so the API stores no branch for them until Settings → Locations moves." with: "The invite's audit row records the sent id (`"sm-br-denver"`) while the stored branch is null, and `PATCH /users/:id` drops an unknown branch the same way (`knownBranch`); such a person can't add a contract and, as a Manager, sees nothing branch-scoped (found while fixing B4)."
8. **A new follow-up bullet,** "**R1 symptoms found while fixing B4 (for `GET /company`, queue task 2):**":
   - the Users page's Branch column is blank in api mode;
   - a new quote's "sold at" defaults to the warehouse, not the rep's showroom (`quote-page.tsx`, showroom by `user.branchId`);
   - comparisons with `user.id` and `user.defaultLocationId` read DemoStore's ids;
   - `saveQuote` still sends DemoStore's `branchId` and `salesRepId`, which the API strips.
9. **"Blockers and open questions".** Add "Owner questions (PR #47, B4)" with Q-B4-1 and Q-B4-2. Append F5's measured time to PR #42's CI question (Q1).
10. **BRANCHES.** Add the row `fix/contracts-branch-from-session` | B (Claude) | B4: the contract form leaves a new contract's branch to the API; F5 runs (main checkout; stacked on #46) | Draft, then "Ready for merge once CI is green" | [#47](https://github.com/TwoWayTech/flooring-platform/pull/47) | see the branch. Move B3's and B1's rows to "Merged on …" once they merge.

## Commands run
Heavy runs go through the scratchpad lock. Logs are in the scratchpad's `b4/logs` folder, and api-mode runs in `flows/logs`.

| Stage | Command | Result |
| --- | --- | --- |
| 0 | `lsof` on 5432 and 5433 (read-only) | the compose PostgreSQL on 5432 and the api e2e one on 5433 are up |
| 0 | `gh pr create --draft …` | draft PR #47 |
| 1 | `heavy.sh pnpm --filter api exec vitest run --project integration test/contracts.int.test.ts` (PostgreSQL on 5432) | 15 passed, the new case among them (it pins the server, which B4 doesn't change); 13 s |
| 1 | three mutations of `newBranch` (`b4/mut-s1.sh`, the new case only): (a) a creator with a branch takes the sent one (`given ?? access.branchId`); (b) the scope check dropped (`if (!given)`); (c) an all-scope creator with a branch picks (`access.branchId && access.dataScope !== "all"`) | each failed as planned: (a) at step 1, "branch B sent" got branch B; (b) at step 5, 201 instead of 400; (c) at step 4, branch B instead of A. The service was restored byte for byte after each, and `git diff --stat -- apps/api/src` is empty |
| 1 | `heavy.sh b4/checks.sh s1 api:lint api:typecheck` | clean, clean |
| 1 | the same integration file again, after labelling step 4 | 15 passed |
| 2 | `heavy.sh pnpm --filter web exec vitest run tests/unit/contracts-api.test.ts`, before the fix | red as expected: 3 failed, each at `not.toHaveProperty("branchId")` (the old `branchId: input.branchId || null` sends DemoStore's `"sm-br-denver"` for the create and the UUID for the other two; the failure message names only the key) |
| 2 | the same, after the fix | 3 passed |
| 2 | `pnpm exec prettier --check` on the three changed files | clean |
| 2 | `heavy.sh b4/checks.sh s2 web:lint web:typecheck web:test` | clean, clean, 35 files and 279 tests passed (B1's tree had 34 and 276) |
| 3 | `heavy.sh b4/checks.sh s3 web:lint web:typecheck` (F5 as planned) | clean, clean |
| 3 | `heavy.sh flows/api-e2e.sh b4-f5-a --build -- …/f5-contract-retainage.spec.ts` | builds 10 s (a fresh `next build`); exit 0, 1 passed, F5 9.6 s |
| 3 | `heavy.sh flows/api-e2e.sh b4-f5-b -- …/f5-contract-retainage.spec.ts` | exit 0, 1 passed, F5 8.4 s |
| 3 | `b4-f5-stop` (the throwaway stopped after "2. the ledger", Billing 1 posted and unpaid) | exit 1 by design: `VARIANT void <Billing 1>: 201` (status `void`), ledger delta since t0 `{}` and every named account 0.00; no clean-up problem, only the planned stop |
| 3 | `b4-f5-stop-paid` (stopped after step 3, Billing 1 paid) | exit 1 by design: the void refused 400 "This billing has a confirmed payment, so it can't be voided." (settled); Billing 1 `posted`; no clean-up problem |
| 3 | `b4-f5-stop-release` and `b4-f5-stop-drop` (first try) | exit 1, **not at the planned points**: "The contract page was not given billing 1's invoice." (step 2) and "… billing 2's invoice." (step 4). The clean-ups did the right thing (release voided 201, Billing 1 refused as paid, settled). The trace showed the wait race (Decisions, stage 3) |
| 3 | `b4-f5-race-old` (an early `GET /invoices` handed to the page after the release POST was sent; step 4 on the old `waitForAnswer`) | exit 1 as expected: "The contract page was not given billing 2's invoice." from the early 262-row answer |
| 3 | `b4-f5-race-new` (the same, on `nextInvoicesRead`) | exit 0, 1 passed, 9.7 s |
| 3 | `heavy.sh b4/checks.sh s3b web:lint web:typecheck` (F5 with `nextInvoicesRead`) | clean, clean |
| 3 | `b4-f5-c`, `b4-f5-d` (the final F5, twice) | exit 0 both, F5 9.4 s and 9.4 s |
| 3 | `b4-f5-stop2` (after Billing 1) | exit 1 by design: Billing 1 voided 201, ledger delta `{}` |
| 3 | `b4-f5-stop2-paid` (after step 3) | exit 1 by design: refused as paid (settled), no clean-up problem |
| 3 | `b4-f5-stop2-release` (after the release posted) | exit 1 by design: the release voided 201, then Billing 1 refused "confirmed payment" (settled); the ledger keeps Billing 1's paid posting only (cash 826.00, retainage receivable 40.00, sales −800.00, sales tax −66.00) |
| 3 | `b4-f5-stop2-drop` (S1 check: "Only the latest billing can be voided." taken out of the set; no stop) | exit 1 as expected: every step passed, then "Clean-up failed, so the flow left data behind: void Billing 1 on CTR-1023: refused for another reason: … Only the latest billing can be voided." |
| 3 | `git status --short` after each throwaway | only F5 modified; no `zz-` file |
| 3 | `heavy.sh flows/api-e2e.sh b4-all` (the whole api-mode suite) | exit 0 after 150 s: 37 passed, 1 skipped (B1's B5 `fixme`; no flow skipped). F1 15.9 s, F2 8.9 s, F3 4.7 s, stale-save 3.1 s, F4 4.5 s, **F5 9.3 s**, F6 11.9 s, F7 5.2 s |
| 3 | `heavy.sh b4/e2e-demo.sh` (demo build; `--project=flooring` `contracts.spec.ts` and `flows-batch3.spec.ts`, one worker) | build 11 s; exit 0, 20 passed in 25.5 s; ports free after |
