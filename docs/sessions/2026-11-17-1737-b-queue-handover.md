# B's queue run, 2026-11-16 to 2026-11-17: handover

- **Person:** B (Claude, the orchestrating session on B's laptop).
- **Branch:** `feat/settings-tax-api` (PR #54), the top of the stack.
- **Base:** `main` at `d0e4e20`.
- **Covers:** the night and day run from B2's merge (PR #44) to the owner's stop after Settings part 3a.
- **Not covered here:** each task's own log, listed under "Files changed", holds its details.

## Goal
Work through the owner's queue of 2026-11-16, unattended, under the owner's standing rules. Keep every result in the repo and hand off cleanly when told to stop.

## Prompt used
**The owner's standing rules** (2026-11-16, "go"):
- Don't ask; keep working until the queue is done or a stop rule hits.
- Each task gets its own branch from an up-to-date main, its own small PR, and a short plan in the session log.
- Read the blueprint prompt (P11 in docs/real-build-plan.md), the product spec and docs/real-build-plan.md first. No plan mode.
- For anything open, pick the safest option and record it in docs/blueprint-delta.md. Follow .claude/commands/feature.md.
- Commit and push after every step. Test with low memory in mind.
- Keep each PR a draft while the reviewers run and their findings are fixed. Mark it ready only when the review is clean, squash-merge under the CLAUDE.md rule, run .claude/commands/handoff.md, and start the next task.
- Between tasks, check that Docker and the databases are up.
- **Stop rules:** stop only if a reviewer finds a blocking issue that can't be fixed, the same check fails three times because of our code, or something needs the owner's decision. A third-party failure is not a stop: retry once after 30 minutes, then move on and come back.

**The owner's queue** (2026-11-16 at about 16:45, sent from the phone, verbatim):
"Queue change from the owner. After #41 and #42 are merged, do these before the whole-product check, each in its own small PR under the usual rules:
1. Bugs, in this order: B2 first (screens must refresh after a save, and My timesheet must never save old hours over an upload), then B3 (the stock panel's "Short by 0.00 ft"), then B1 (salesperson quote builder crash when cost is withheld; security review required), then B4 (branch-assigned users can't save a contract; security review required). After each fix, turn the matching e2e flow (F1, F2, F5) back on from fixme.
2. Move the remaining screens to the API: GET /company first (roles, modules and permission limits, so buttons match what the API allows), then Settings, the notification bell and the Outbox, stock adjustments, installation jobs, a trial balance screen, and the passkey screens with the QR code. Make today() use the company's time zone.
3. Then the whole-product check: compare every item in docs/product-spec/, docs/FEATURES.md and docs/demo-script.md with what runs on the real API, and write docs/real-build-coverage.md (done, partly done, missing). Add tests proving the trial balance always balances and that customer balances, supplier balances and stock value agree with the ledger. Add a permission-matrix test that calls every endpoint as every role and as another company's user. Create a fresh company with the setup script, import sample CSV data, and run docs/demo-script.md in api mode with Playwright. Fix what you find in small PRs.
4. Then stop and hand off. Don't start P13; the owner does a click-through first."

**The owner's stop** (2026-11-17, while part 3a was in review): "When you finish the step you're on now, stop. Commit and push everything (draft PR if the task isn't done), then run .claude/commands/handoff.md and write a clear handover for A in STATUS."

## What was done
| PR | Branch | Task | Session log |
| --- | --- | --- | --- |
| #44 (merged, `d0e4e20`) | `fix/web-reread-after-write` | B2 | `2026-11-16-1651-b-reread-after-write.md` |
| #45 | `fix/web-stock-short-by` | B3 | `2026-11-16-2205-b-stock-short-by.md` |
| #46 | `fix/sales-quote-without-cost` | B1 | `2026-11-16-2320-b-quote-without-cost.md` |
| #47 | `fix/contracts-branch-from-session` | B4 | `2026-11-17-0024-b-contract-branch.md` |
| #48 | `fix/sales-dashboard-without-cost` | B5 (found while fixing B1) | `2026-11-17-0146-b-dashboard-without-cost.md` |
| #49 | `fix/sales-quote-resave` | B6 (found while fixing B1) | `2026-11-17-0300-b-quote-resave.md` |
| #50 | `feat/web-company-from-api` | `GET /company` | `2026-11-17-0525-b-company-from-api.md` |
| #51 | `feat/settings-sections-api` | Settings part 1 | `2026-11-17-0700-b-settings-sections-api.md` |
| #52 | `feat/settings-localization-api` | Settings part 2a | `2026-11-17-1100-b-settings-localization-api.md` |
| #53 | `feat/settings-region-currency-api` | Settings part 2b | `2026-11-17-1330-b-settings-region-currency-api.md` |
| #54 | `feat/settings-tax-api` | Settings part 3a | `2026-11-17-1510-b-settings-tax-api.md` |

**Planned, not built:**
- docs/specs/settings-part-3b-plan.md (Settings part 3b);
- docs/specs/settings-part-4a-plan.md (Settings part 4a, with an outline of 4b).

**Paused at the owner's choice:** draft PR #43, the whole-product check. Its final plan is now committed on its own branch as `docs/specs/whole-product-check-plan.md`.

## How each task ran
1. **A plan, a critic and a final plan.** Written read-only while the previous task built.
2. **Builder agents, following the final plan:**
   - the spec and session log;
   - red tests first;
   - the change with its unit and API tests;
   - mutations;
   - api-mode and demo e2e;
   - docs;
   - full checks and the whole api-mode suite.
3. **Review rounds.** Each round had a fresh read-only security-reviewer and a correctness reviewer. Every should-fix or blocking candidate went to a skeptic, and every confirmed finding was fixed with a test that failed first. Rounds repeated until one was clean (extra rounds for #49 and #51).
4. **The orchestrator's handoff:**
   - STATUS and BRANCHES from the log's "For STATUS";
   - the review summary posted on the PR;
   - a `[skip ci]` handoff commit.

## Decisions and why
- **Stacking.** GitHub Actions was blocked by billing (Blockers), so no PR could self-merge. The safest option was to keep working in queue order, with each branch cut from the previous one's handoff head. That kept STATUS and BRANCHES linear and kept every result pushed. The stack merges in order once CI runs (STATUS "Handover for A").
- **B5 and B6 joined item 1.** B1's audit and its API test found them. Both are api-mode bugs of the same class: they crash or refuse a salesperson's normal work. The safest-option rule put them right after B4; the owner may move them (PR #46 Q2 and Q6).
- **Settings was split into parts:** 1, 2a, 2b, 3a and 3b, then 4a, 4b, 5 and 6 (ADR 0059 "Later parts"). Each part stays a small, reviewable PR, with the money-, tax- and payroll-sensitive pieces reviewed on their own.
- **No schema, migration, dependency, core-auth, tenancy or provider change anywhere.** Designs that would need one were left out and asked instead. Examples: an editable time zone, a versioned company tax default, storing an accepted quote's tax.
- **Extra review rounds** when the last fix hadn't been reviewed (#49 and #51), so every PR ends on a clean round.
- **Plans committed at the stop.** The plans for 3b and 4a, and #43's whole-product check plan, lived only in B's laptop scratchpad. They are now committed under docs/specs/: 3b and 4a on this branch, #43's on its own branch (CLAUDE.md: nothing important on one laptop only).
- **The handover was checked before committing.** Two read-only agents compared STATUS "Handover for A" with git, GitHub and the repo, one for accuracy and one for completeness. Their findings were applied:
  - the merge procedure for the stack: `git merge -s ours origin/main` after checking that main equals the PR below, never a plain merge that keeps both sides;
  - `fast` added to the merge conditions, and no push to #45;
  - EET times, and the re-run time corrected to 01:25;
  - #43's log and plan, with where to find them;
  - the ask-first items (passkeys, part 6, the invite-branch fix);
  - CI time and the 25-minute `verify` limit;
  - the test-environment notes and B's Mac's leftovers;
  - STATUS's stale "In progress" and "Next three tasks" lines.

## Commands run and results
- **Per task:** every task's full checks, whole api-mode suite, demo runs and mutations are in its own session log and STATUS "Done" entry.
- **Final full checks** on `feat/settings-tax-api` at `599d0d8` (lint, typecheck, `pnpm test`, `pnpm test:api`, `pnpm test:hooks`), 17:34 to 17:38: every step exit 0. `pnpm test`: shared 1,161, web 418, api 126, db 18, providers 11. `pnpm test:api`: api 787, db 59, providers 2; this ran fresh in 3 min 48 s, while lint, typecheck and `pnpm test` were partly Turbo cache hits from round 2's own run.
- **CI:** none could run (billing). The last attempt was a re-run of PR #45's `e2e` at 2026-11-17 01:25 EET (run 43954258826, attempt 3), refused. All times in this log are EET (UTC+2).
- **Screenshots:** none taken by this session. The e2e traces stayed in B's laptop scratchpad.

## What is left
See STATUS "Handover for A":
- **Merging:** the merge procedure for #45 to #54 once billing is fixed.
- **Queue item 2:**
  - Settings part 3b, from its plan;
  - Settings part 4a, from its plan;
  - Settings parts 4b, 5 and 6;
  - the bell and the Outbox;
  - stock adjustments;
  - installation jobs;
  - a trial balance screen;
  - passkeys with the QR code;
  - `today()` in the company's zone.
- **Queue item 3:** the whole-product check, PR #43.
- **Queue item 4:** stop and hand off; no P13.

## Next prompt
"Read docs/STATUS.md on `feat/settings-tax-api` ("Handover for A"). If GitHub Actions runs again, merge the stack #45 to #54 in order, as that section says. Then build Settings part 3b from docs/specs/settings-part-3b-plan.md on a branch from main (or stacked on #54 while CI is still blocked), with `/review` and a security review."
