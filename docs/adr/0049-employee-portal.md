# ADR 0049: The employee portal on the API (own data only)

- **Status:** accepted, 2026-11-14
- **Context:** employee-portal.md describes one read, `myPortal`, that every `/my` page uses, plus own-profile changes, plan signing and the clock. Its "Edge cases and known limits" list what a real API must fix: hidden values still in the response (the pay rate, `teamOut`'s policy and hours, plan terms when commission is hidden), `hr.clock` not read and `clockOut` not checking the company setting, and documents open to anyone with a key. HR parts 1 and 2 (ADR 0046, 0047) and commissions (ADR 0048) put the records on the API; the clock routes already existed. docs/real-build-plan.md row 13 and the week-17 row: "portal shows own data only".

## Decision

### Routes
- `GET /me/portal` returns the `MyPortal` projection; `PATCH /me/employee` changes one's own phone and emergency contact; `POST /commission-assignments/:id/acknowledge` signs one's own plan. Module `hr`, switch `hr.portal` (404 when off), key `hr.portal.view`; nothing else is needed, because every route acts on the session's own person. docs/api-contract.md, "Employee portal".
- **The person is the session:** the user id from the verified session and the employee linked to that sign-in (`user_profiles.employee_id`, live employees only, `viewerEmployeeId`). No route takes a person, employee, user or company id; query parameters are ignored. An email match never counts here: it is for refusals only (ADR 0046).
- `clockIn` and `clockOut` use the existing `POST /clock/in` and `/clock/out`.
- The web client sends `myPortal`, `updateMyEmployeeProfile`, `acknowledgePlan`, `clockIn` and `clockOut` to the API (`API_METHODS`); the screens do not change. My meetings still reads the demo client until Meetings moves (the next module).

### What each person sees (rules 1 to 11, decided on the server)
- **Shared rules:** `portalVisibility`, `ownPayLine`, `earnedInYear`, `ownStatements` and `teamOutView` are in packages/shared (`hr/portal.ts`); the demo's `myPortal` calls them too.
- **Narrowed on the server**, on top of the company's switches: pay needs `hr.pay-periods`; commission needs `hr.commissions` and the `core` module (Flooring Suite); the clock needs `hr.clock`, `hr.timesheets`, a designated workweek and someone who fills in timesheets; the team calendar needs `hr.time-off` and a linked W-2 employee (it is on My time off, which a 1099 worker does not have; rule 11).
- **Pay rate:** sent only when the company shows rates **and** the person holds `hr.employee.view_sensitive`; `visible.rates` says so. The sensitive-fields interceptor strips `payRate`, `baseRate`, `regularRate` and `salaryAmount` without the key anyway (CLAUDE.md rule 5), so the setting alone never reveals a rate. Owner question below.
- **Pay:** only approved or exported runs with a stored line for the person, newest first. The period travels with `lines` and `excluded` empty, so nobody else's pay or exclusion leaves the server. Hidden commission leaves the line and its total (`ownPayLine`), and so does the workweek breakdown (`weeks`), whose allocated earnings and regular rate carry the commission. `earnedThisYear` adds the rows paid in the company's current year, with decimal.js.
- **Commission hidden:** `statements` empty and `assignment` and `plan` null, so no plan terms (rates, tiers, target, draw) leave the server. Shown: one's own statements (the shared engine, margin base hidden without `sales.margin.view_sensitive` as on HR → Commissions), one's own running assignment and its plan.
- **Team calendar:** colleagues' approved requests ending no more than 92 days ago or later, of people who have not left, with the kind `vacation` and the note, reason, policy, hours and decider removed; `teamNames` lists only the people in it.
- **1099 workers:** no timesheets, time off, pay or clock; only their own contractor payments (with `hr.pay-periods` on). **Unlinked people:** an empty overview, never an error.
- **Settings:** the portal reads Settings → HR without failing: a switch not saved as on is off; without a designated workweek there are no timesheets and no clock.

### Writes
- **Own profile:** strict body `{ phone, emergencyContact }`; the employee is locked, the trimmed values stored, and "Updated own profile" written in the same transaction with the old and new phone and only whether the emergency contact changed (it is another person's data). A save that changes nothing writes nothing. An unlinked sign-in gets 400.
- **Signing a plan** (commissions.md rule 15): under `PAYROLL_LOCK` (as a plan edit that clears signatures), then the assignment row. It must be the session user's (else 404), running, unsigned, and shown to them on My commission; the typed name must be the account's name, ignoring case and surrounding spaces. "Signed commission plan" is audited with no amounts.
- **Clock-in and clock-out** also need the `hr.portal` switch, because the clock lives in the portal. **Clock-out** now refuses when the company's clock setting is off, as clock-in does. A punch left open while the clock is off stays open (the portal still shows when it started) and closes once the clock is back on; a punch over 24 hours adds no hours, as before.
- **Own documents:** `GET /files/:id` also accepts `hr.portal.view`; with it alone, only a document on the employee linked to the reader's own sign-in opens (switch `hr.portal`). Every other owner type keeps its own keys.

## Safest options taken (also in docs/blueprint-delta.md)
- The pay rate needs view_sensitive as well as the company setting (CLAUDE.md rule 5 over the setting).
- A rep whose commission is hidden does not sign in the portal: a signature acknowledges terms the person has read, and the terms stay on the server. HR shows commission to that person (the per-person setting) or signs on paper.
- Margin base on one's own statement is hidden without `sales.margin.view_sensitive` (commissions.md rule 18 showed it).
- The team calendar is for linked people only and names only the people in it.
- Clock-out honours the clock setting (the task asked for both clock routes).

## Residual risks
- **Override lines:** a manager's own statement lists their reports' override lines (the report's user id, invoice id and collected amount): that is the manager's own pay basis, as HR → Commissions shows it.
- **Margin base:** a hidden margin base can be worked back from a line's commission and the plan's rate, as on HR → Commissions (ADR 0048).
- **Overtime true-up with hidden commission:** `overtimeTrueUp` also holds the California flat-sum bonus premium, so taking all of it out (rule 3) understates the estimate for someone with such a bonus; the page labels it "Estimated gross pay from hours and leave".
- **One link per employee** is enforced by People (`PeopleService.link`), not by a unique index on `user_profiles.employee_id`; the portal, own documents and pay rely on it. A partial unique index is a schema change for the owner to approve (STATUS follow-up).
- **People who have left** keep their sign-in's portal: they may still update their phone and emergency contact and sign a running plan, which changes no pay.
- **HR's form and a portal edit** can overwrite each other's phone or emergency contact (a lost update, not a leak).
- **Load:** a portal read with commission shown builds the company's commission book, as HR → Commissions does.

## Questions for the owner (docs/STATUS.md)
- Should "Show pay rates to employees" reveal a person's own rate and salary on My profile and My pay without `hr.employee.view_sensitive`? Today it does not; a salaried person's My pay shows hours pay and gross pay, not the salary line.
- Should a rep with hidden commission be able to sign their plan somewhere (Labor Code 2751 needs a signed receipt)? Today HR must show commission to that person first.

## Consequences
- The portal's known limits on hidden values, `hr.clock`, clock-out and documents are closed on the API; the demo shares the same rules for what it can.
- My meetings, requesting a meeting and the meeting list stay on the demo client until Meetings moves.
- No table changed and no dependency was added.
