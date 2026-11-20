# Session 2026-11-20 11:17, A (Claude): the bell, the Outbox and Settings → Email on the API

Person: A (Claude), on A's Windows laptop, working unattended. Worktree `C:\dev\fp-bell`, branch `feat/notifications-api`, based on Settings part 5 (`0bb7424`, PR #62). The other checkouts (`C:\dev\flooring-platform`, `fp-work`, `fp-work2`, `fp-3b`, `fp-4a`, `fp-4b`, `fp-5`, `fp-6`) belong to others and are not touched.

**Owner's queue:** "Move the remaining screens to the API: … the notification bell and the Outbox …", and ADR 0059 "Later parts" row "with the bell and Outbox: `email` (sender details), DemoStore's money format in its messages". No plan file exists; this log holds the plan.

## Prompt (orchestrator, summarised)

- The bell's reads and writes on the API for the signed-in person only; the Outbox (sent and failed emails, Retry) with its permission key, data scope and the restricted-message rule; Settings → Email (sender details) on parts 1 to 5's per-section pattern, with a step-up if that is the safest option; money in messages in the company's number format; the methods in API_METHODS so screens move without changing; DemoStore keeps the same rules.
- Outside services only through packages/providers' EmailProvider. No schema change, migration, dependency, providers or core auth/tenancy change (stop and report if one is needed). If too large, build the bell and Email first and record the Outbox for a follow-up.
- A fresh read-only security-reviewer until a round is clean. Commit after each step, push with exactly `git push -q origin feat/notifications-api`. No PR, no merge, no gh write.

## What the spec and ADRs say

- notifications.md: the bell reads `listMyNotifications` and marks read with `markNotificationsRead` (own rows only); the Outbox page reads `listOutbox(all)`, where `admin = all && can("settings.outbox.view")`; own rows are the ones the person caused or received; another's restricted row is redacted ("Restricted message", "Only the people involved can read this.") without `hr.employee.view`, and a private meeting's row for everyone not involved (ADR 0051). Retry and Cancel: spec says own rows or `settings.outbox.view`.
- ADR 0032 built the API core: `GET /notifications`, `POST /notifications/read`, `GET /outbox`, `POST /outbox/:id/retry|cancel` (retry and cancel need `settings.outbox.view`, "stricter on purpose, until the Outbox screen moves to the API"). The API never returns template values, the dedupe key or the provider id.
- ADR 0051 part 3: in api mode the bell and Outbox still read DemoStore's rows; Simulate reply reads the demo Outbox.
- ADR 0059: the per-section pattern; residual risk "the bell's and Outbox's money format is DemoStore's until that task".
- Found while reading: DemoStore's `money` is `` `$${formatNumber(amount, "money", …)}` `` and `formatNumber` already writes the currency sign, so every demo message shows "$$1,250.00"; the API's `quote.sent` passes the raw total ("1250.00"); `loadMoneyFormat`'s never-saved fallback writes a literal `$`.

## Plan (decisions D1…)

- **D1. The bell.** `listMyNotifications` → `GET /notifications` (the API also answers `userId`, the reader's own); `markNotificationsRead(ids)` → `POST /notifications/read { ids }` in chunks of 200, and nothing is sent for an empty list, because the API reads no ids as "all of mine" while the contract's empty list means none.
- **D2. The Outbox read.** `listOutbox(all)` → `GET /outbox?all=true` or `GET /outbox`. The API now applies the spec's `admin = all && settings.outbox.view`: without `all=true` even an admin gets only their own rows (the personal `/outbox` page). The answer gains `fromName` and `replyTo` (the sender snapshot the drawer shows); values, dedupe key and provider id stay out. The web maps a row to `OutboxMessage` (recipient object; `values` `{}`; `dedupeKey` `""`). A 404 (`settings.outbox` off) is an empty list for the Email settings page's preview.
- **D3. Retry and Cancel keep `settings.outbox.view`** (ADR 0032, the safest option): no permission is widened. DemoStore is aligned to it (it let anyone retry or cancel their own rows), and the Outbox drawer shows Send again and Cancel message only to holders. Owner question Q1. The http methods answer the row as re-read from `GET /outbox?all=true`.
- **D4. Presenter tools stay demo-only.** Simulate bounce and Simulate reply are hidden in api mode (`isDemoMode`); `simulateBounce` and `simulateReply` are not routed.
- **D5. Words in api mode.** The Outbox banner "This demo never sends real email…" shows only in the demo; in api mode a sent row is "Sent", not "Sent (simulated)".
- **D6. Money in messages.** One shared `messageMoney(amount, numbers)` (`formatNumber` money, which already carries the currency sign): DemoStore's double sign is gone; the API's `loadMoneyFormat` uses it with the stored format or the US pack's (`defaultNumberSettings`) instead of a literal `$`; `quote.sent`'s total is formatted.
- **D7. `PUT /settings/email`.** `SETTINGS_SECTIONS.email` (`settings.notifications.manage`; module `platform`, so no module guard, as profile and numbers), the `settings.notifications` switch (404), scope `all` (403), a strict body (400), `emailSettingsProblem` (400), then always a step-up (403 `step_up_required`), after the content checks so a refused value never costs a code: the reply-to and the sender name decide where customers' answers to invoices and receipts go and who the mail seems to be from (phishing), and the sign-off is under every message. One audit entry "Changed email and notifications". Answers the section as saved.
- **D8. Content rule (`emailSettingsProblem`, packages/shared, the same words in both modes).** Sender name at most 80 characters, no line break, quote, backslash or angle bracket (the From header strips them; refusing keeps what is shown what is sent); empty means the company's name, which the API's sender already uses. Reply-to empty or one plain address (`EMAIL_TEXT`), at most 254 characters. Sign-off at most 500 characters.
- **D9. Who reads it (`SETTINGS_READERS.email`).** `settings.notifications.manage` only (only its page reads it); hidden while `settings.notifications` is off. The API's sender reads the stored row whatever is answered. No property is a `SENSITIVE_FIELDS` name.
- **D10. Never saved.** Answered as stored-empty (`senderName` "", `replyTo` "", `signature` ""), which is what the API acts on (the company name as sender, no reply-to, no sign-off).
- **D11. DemoStore.** The same key, switch, scope and rule through the dispatcher; its notify uses the company name for an empty sender name. Its step-up is the dialog.
- **D12. The page.** The Sender form passes `problem` and `stepUp`; the sender name's helper says an empty name sends as the company.

## Build decisions (B1…)

- **B1. One sight rule, shared.** The API's `visibleOutboxRow` rule moved to packages/shared (`outboxSight`, `OutboxReader`, `REDACTED_OUTBOX`) instead of being copied into DemoStore; `notification-rules.ts` keeps `visibleOutboxRow` as a thin wrapper. DemoStore gains the API's sealed private-meeting rows and the address compared without case.
- **B2. `?all=true` is exact.** Any other value, a repeated parameter (an array) or none is the personal view.
- **B3. The quote email read the quote from before the send** (old total, no expiry): `updateQuoteStatus` now emails the quote re-read after the commit. Found by MQ1.
- **B4. `userId` in `GET /notifications`**, the reader's own id, so the answer is the contract's `InAppNotification` with no mapping.
- **B5. `markNotificationsRead` sends only UUIDs**, so a DemoStore id left on screen can't make the batch a 400, and an all-demo list sends nothing.
- **B6. Part 1's `settings.int` A1, A8, A9b** compare part 1's sections (`partOne`); A1 also checks nothing else but `email` comes, to its readers. Email per role is `settings-email.int` ME1.
- **B7. Never-saved Email answered empty** rather than with the company name: the answer is what is stored, and the empty name's meaning ("the company's name") is the same in both modes and on the page's helper text.
- **B8. Pre-existing:** the demo e2e "marking an invoice sent puts a message in the Outbox" always skips, because every seeded invoice is already sent; DN1 covers the message (and its money) by making one unsent first.

## Commands and results

## Mutations

## Owner questions (none blocks; each with its safest default taken)

- **Q1. Retry and Cancel on one's own rows.** The spec lets anyone send again or cancel their own message; the API keeps ADR 0032's `settings.outbox.view` and DemoStore now matches it. Widen it?
- **Q2. Notification rules in api mode.** Event switches, channels and templates (`saveNotificationRule`, `list("notificationRules")`) still save in the browser only in api mode, while the API reads its own `notification_rules`. A follow-up PR.
- **Q3. Dates in messages.** Message variables carry dates as `yyyy-MM-dd` (both modes, the spec's known behaviour); money now follows the company's number format. Format dates with the company's date format too?
- **Q4. The sender name's characters.** Taken: no `@`, quotes, backslashes, angle brackets, control characters, line separators or text-direction marks (security review round 1), so a name can't pass for an address. Too strict for any company's real name?

## Security review

- **Round 1** (fresh read-only security-reviewer on `0bb7424..67c4e18`): **nothing blocking**; four Low findings.
  1. A sender name could still look like an address or another party ("billing@yourbank.example") or carry Unicode line separators and text-direction marks. **Fixed:** `emailSettingsProblem` also refuses `@`, U+0080 to U+009F, U+2028, U+2029, U+202A to U+202E and U+2066 to U+2069 (new words, both modes); R12 and ME4 cases.
  2. The reply-to took display-name and list syntax (`x"<a@b.c>`, `a,b@c.d`). **Fixed:** `REPLY_TO_TEXT`, one plain mailbox without `"<>,;()[]\`; R12 and ME4 cases.
  3. The API read `{ ids: [] }` as "mark all". **Fixed:** an empty list marks none, no list marks all; the notifications int case checks both.
  4. The quote email's expiry is `yyyy-MM-dd`, not the company's date format. **Not changed:** dates in message variables are `yyyy-MM-dd` in both modes (spec "Edge cases": "Dates in variables are stored as YYYY-MM-DD"); a company date format in messages is recorded as Q3.
- **Round 2** (fresh reviewer on `0bb7424..50f3d68`): **nothing blocking**; three Low, two informational.
  1. Look-alike `@` (U+FF20, U+FE6B), LRM/RLM/ALM and zero-width characters passed the sender name. **Fixed:** the name is judged on its NFKC form and the class adds U+061C, U+200B to U+200F and U+FEFF (`isPlainSenderName`); R12 cases.
  2. The worker trusted the stored row (a row written before the rule, or the company display name as sender). **Fixed:** `senderHeaders` applies `isPlainSenderName` and `isPlainReplyTo` at send time; a failing name sends as the platform address alone, a failing reply-to is left out; unit cases in `notification-rules.test.ts`.
  3. The reply-to pattern let control characters through. **Fixed:** `REPLY_TO_TEXT` excludes U+0000 to U+001F and U+007F to U+009F; R12 cases.
  4. (Info) The whole-company Outbox and Retry/Cancel ignored data scope (CLAUDE.md rule 3). **Fixed, the safest option:** both need data scope `all` besides `settings.outbox.view`, 403 with the settings words, on the API and in DemoStore; notifications int and DN6 cases. No default role changes (only the Owner holds the key).
  5. (Info) A redacted row still showed `sourceId`. **Fixed:** empty on a redacted row in both modes; the meetings, notifications and api-mode e2e cases now find the rows by id or recipient.

## For STATUS (the orchestrator applies these)

## Reviewer summary (ready to paste with `gh pr review <n> --comment --body-file`)
