# 2026-11-21 18:30, A: meetings drag move versus resize

## Goal
Close click-through findings #44 (major), #43 and #45 on branch `fix/meetings-drag-move`.

## What changed
- **#44, move versus resize.** `TimeGrid` now takes one pointer-down on the whole block and asks `dragModeAt` (apps/web/src/features/meetings/drag-mode.ts) whether it is a move or a resize: only a band of `RESIZE_BAND_PX` (6 px) at the bottom edge, never more than a quarter of the block, resizes. Before, an 8 px handle sat over a 24 px block, a third of it, and the press often landed there. The band shows `cursor-ns-resize`.
- **#44, words.** `moveKind` (packages/shared meetings/moves.ts) calls a change that keeps the occurrence's start a resize. The screen words its dialog, button and toasts by it (`move-words.ts`: "Change a repeating meeting's length", "Change length", "<title> now lasts N minutes", "Length change undone"). The API and DemoStore audit a resize as `Changed meeting length` (`MEETING_AUDIT_ACTIONS.resized`), worked out from the stored occurrence (`occurrenceTime`), so the request body is unchanged and the client can't mislabel it. Undo accepts either entry (`isMoveAuditAction`).
- **#44, Undo.** The move toast lasts `UNDO_TOAST_MS` (10 s) instead of sonner's 4 s default.
- **#43.** Blocks under 40 px show time and title on one line (title truncated), and every block has a `title` tooltip with time, title and length. The accessible name still starts with the time.
- **#45.** Summit's Weekly sales huddle invites the active sales team (Priya, Evan, Nadia) with Dana organising, through a step at the end of `withMeetingRecords` that draws no random numbers, so the rest of the fixtures are unchanged (one line of summit.json). The organiser's reminder is left as is: meetings.md sends `meeting.reminder` to "Staff guests only", and ADR 0051 part 1 says "never the organiser".
- Docs: meetings.md (Move or resize, audit table), api-contract.md (reschedule and undo rows), blueprint-delta.md.

## Checks run
- `pnpm lint`, `pnpm typecheck`: pass.
- `pnpm --filter @workspace/shared test`: 86 files, 1254 tests pass.
- `pnpm --filter web exec vitest run tests/unit`: 81 files, 580 tests pass.
- `pnpm --filter api test`: 18 files, 129 tests pass.
- API integration with `--maxWorkers=1`: `meetings-moves.int.test.ts` 32 pass, `meetings.int.test.ts` 32 pass; packages/db `seed.int.test.ts` 14 pass. (The first run was cut short when the shared Postgres restarted, and was run again.)
- Playwright not run locally (shared laptop); CI's `e2e` runs the new and changed specs in apps/web/tests/e2e/meetings.spec.ts.

## Open questions
- Should the organiser get a reminder too? The spec says staff guests only; unchanged here.
