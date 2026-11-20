# Session 2026-11-20 15:16, A (Claude): the passkey screens with the QR code

Person: A (Claude), on A's Windows laptop, working unattended. Worktree `C:\dev\fp-pk`, branch `feat/auth-passkey-screens`, stacked on `feat/inventory-stock-rules-api` (PR #66). The other checkouts belong to others and are not touched.

**Owner's queue:** item 2, "the passkey screens with the QR code" (STATUS line 93), approved on 2026-11-20 with the `qrcode` library, after `/verify-password` (STATUS "Owner's answers", line 144; docs/blueprint-delta.md, first row).

## Prompt (orchestrator, summarised)

- Build the passkey screens and the QR code; add `qrcode` to apps/web only, pinned, with an ADR (approved 2026-11-20); render the QR locally and never log the secret or the link.
- Registration calls `POST /api/auth/verify-password` first; plain words for `password_confirmation_required`, `mfa_required` and the rest; list, rename, delete; demo mode behaves sensibly.
- Tests with every change (web units, API integration only if the API changes, an api-mode Playwright spec with a CDP virtual authenticator). Commit and push after every step. No server or Playwright run until the ports are handed over. A fresh security reviewer each round until clean. No PR, no STATUS or BRANCHES edit.

## What the docs say (my reading)

- docs/api-contract.md, Authentication: `/verify-password` `{ password }` confirms the password for 5 minutes on this session, 10 a minute per IP, wrong ones count towards the lockout (429 `account_locked`). `/passkey/*` is Better Auth's plugin: registering (`generate-register-options`, `verify-registration`) needs a sign-in at most 10 minutes old and the password confirmed in the last 5 minutes, else 403 `password_confirmation_required`; `createSession: true` → 400; adding emails the account; sign in with `generate-authenticate-options` and `verify-authentication`; list, rename, delete; deleting the last factor of a required user → 403 `mfa_required`; user verification required. A password sign-in by a required user whose only factor is a passkey → 403 `passkey_required`.
- ADR 0029 part 2, last paragraph: "The login page has the code step … and set-up for required users: the password again, the setup key in groups of four with a copy button … Passkey screens and a QR code are B's (STATUS), because they need `@simplewebauthn/browser` in the web app." blueprint-delta's 2026-11-20 row: "`qrcode` library for the **authenticator QR code**".
- **Reading of "the passkey screens with the QR code":** two things. (1) The QR code is the authenticator app's `otpauth://` link, drawn on the set-up step next to the setup key, so a phone scans it instead of typing the key. Passkeys need no QR from us (a browser shows its own cross-device QR itself). (2) The passkey screens: add a passkey (password first), list, rename and delete them, and sign in with one, which a required user whose only factor is a passkey must do (`passkey_required`).
- The settings spec has no account-security section; the API already serves every endpoint, so the API does not change.

## Plan (decisions D1…)

- **D1. QR code** on the authenticator set-up step at sign-in, where the app is set up today. (Setting the app up from the new security page, for people whose role does not require it, is not added: Q3.) Drawn as an SVG from `qrcode`'s module matrix (`QRCode.create`), with React elements, no `innerHTML`, no network, no logging. Dark modules on a light tile in both themes (scanners need it), through two new tokens.
- **D2. Passkey at enrolment:** the "Set up two-step sign-in" step offers a choice: authenticator app (as today) or a passkey (password, then the browser's prompt, named). A required user may finish enrolment with either.
- **D3. Sign in with a passkey** on the api-mode login page: a secondary button under the password form. A `passkey_required` refusal shows its words and points at the button.
- **D4. A "Sign-in and security" page** at `/account/security`, from the avatar menu, in both products and both modes: whether two-step sign-in is required and on (authenticator app, passkeys); the passkey list (name, date added) with Add, Rename and Remove. Add asks for the password (`/verify-password`), then the name, then the browser's prompt. Remove asks to confirm; `mfa_required` is shown in plain words.
- **D5. No Better Auth client in the web app.** apps/web has never had one: every auth call is a plain `fetch` to `/api/auth/*` (lib/session/api-auth.ts). Better Auth's `passkeyClient` would bring `better-auth`, `@better-auth/passkey`, `nanostores` and `@simplewebauthn/browser` into the web app, none of them approved. The WebAuthn ceremony is a small local module (`lib/session/webauthn.ts`: base64url to bytes and back, `navigator.credentials.create`/`get`, errors by name), with the same request and answer shapes as the plugin's client. Recorded in the ADR.
- **D6. The page goes through the ApiClient** (CLAUDE.md rule 1): new methods `signInSecurity`, `confirmPassword`, `addPasskey`, `renamePasskey`, `deletePasskey` in the contract; API_METHODS call `/api/auth/*` (the only route that carries the proxy secret and client IP); DemoStore simulates them (any password, no browser prompt, the last factor of a required role refused with the API's words). The login-page parts call lib/session directly, as the existing sign-in and enrolment do.
- **D7. No feature switch.** `auth.mfa` is the demo's simulated code step; the security page is part of signing in, not a module feature. Q1.
- **D8. Names:** 1 to 60 characters, trimmed, on screen; the default is the browser and system ("Chrome on Windows"). The API does not bound the length (Q2).

## Tests planned

- Web units: QR matrix and SVG path (`qr-code`), base64url and the ceremony's request/answer shapes and error mapping (`webauthn`), the passkey calls' error words by code (`passkeys`), DemoStore's simulated passkeys (`demo-passkeys`), the router (`api-router` if it lists methods).
- api-mode Playwright (`passkeys.spec.ts`): a CDP virtual authenticator; the owner enrols with a passkey at sign-in (password first), signs out, a password sign-in is refused `passkey_required`, signs in with the passkey, renames it, adds a second (password first), and cannot remove the last one (`mfa_required`). Demo spec: the security page lists, adds, renames and removes simulated passkeys, and lays out at 375 px with axe clean.

## Build decisions (B1…)

- **B1. One step for the choice and the password.** The set-up step asks "How do you want to confirm it is you?" (Authenticator app, the default, or Passkey) above "Confirm your password", so the existing e2e helpers that enrol an app (accounts.ts) work unchanged. The app path calls `two-factor/enable` as before; the passkey path calls `/verify-password`, then shows the name step. "Step n of 3" for the app, "of 2" for a passkey.
- **B2. A password check that ran out** (`password_confirmation_required` from `generate-register-options` or `verify-registration`) returns to the password step with the reason shown, both at enrolment and in the Add dialog.
- **B3. `HttpTransport.auth()`:** the same fetcher and re-reads on `/api/auth`, so the ApiClient methods reach Better Auth through the proxy's vouched route and the router's re-read rule holds (`api-rereads.test.ts` classifies the five new methods: `signInSecurity` read, `confirmPassword` a read POST, add/rename/delete writes).
- **B4. The list keeps only id, name, date added and backed-up** from Better Auth's rows (which carry the public key and credential id).
- **B5. Refusals by code** (`PASSKEY_REFUSALS` in lib/session/passkeys.ts): `INVALID_PASSWORD`, `password_confirmation_required`, `SESSION_NOT_FRESH` (a passkey can be added only in the first 10 minutes after signing in), `mfa_required`, `passkey_required`, `PASSKEY_NOT_FOUND`, `AUTHENTICATION_FAILED`, `FAILED_TO_VERIFY_REGISTRATION`, `CHALLENGE_NOT_FOUND`; `account_locked` keeps the API's words; a 429 with no code is the per-IP limit. Browser refusals by DOMException name (`NotAllowedError`, `InvalidStateError`, `SecurityError`, `NotSupportedError`, `AbortError`) and "this browser cannot use passkeys". On the login page an unknown passkey says it does not belong to an account here.
- **B6. QR tokens** `--qr-ink` and `--qr-paper` (packages/ui globals.css), the same in both themes, as `fill-qr-ink` and `bg-qr-paper`.
- **B7. Demo:** `DemoPasskeys` keeps passkeys per company and person in memory (lost on reload, as the demo's code step remembers nothing); the last factor of a role that needs MFA (Owner or an MFA key, `roleRequiresMfa`) without the simulated app (`mfaEnrolled`) is refused with the API's words.
- **B8. No server change.** The API already enforces every rule; its tests (mfa.int.test.ts) cover them, so no API integration test was added.

## Owner questions (none blocks; the safest default is taken)

- **Q1. A feature switch for Sign-in and security?** Taken: none; signing in is not a module feature, and `auth.mfa` stays the demo's simulated code step.
- **Q2. Bound passkey names on the API** (the plugin accepts any length)? Taken: 1 to 60 characters on screen only; a server bound needs an auth hook change (asked first, CLAUDE.md).
- **Q3. Let people whose role does not require MFA set up the authenticator app from Sign-in and security** (and turn it off)? Taken: not built; the page shows whether it is set up.
- **Q5. Removing or renaming a passkey needs only a session** (the plugin's ownership check), and removal sends no email; adding asks for the password and emails. Ask for the password and email the account on removal too? Taken: unchanged (an API auth change, asked first); the screens confirm a removal in a dialog. From review round 4.
- **Q4. ADR number:** 0060 (0058 stays reserved by the paused whole-product check). If another branch takes 0060 first, this one renumbers.

## Security review

- **Round 1** (fresh `security-reviewer`, diff 29e8d42..21128ed): **PASS, nothing blocking.** Four notes:
  1. A failure that is not an ApiError (say a 2xx body that is not JSON) left the passkey and enrolment buttons stuck. Fixed: `failureWords` (lib/api/errors.ts) gives every failure words and frees the button, in the name step, the enrolment password step and the dialogs (PK13).
  2. No way back from Passkey to the authenticator app at enrolment, for a device that cannot make a passkey. Fixed: "Use an authenticator app instead" under the name step (passkeys.spec.ts, enrolment step).
  3. In existing API code, `checkNoDowngrade` (auth-hooks.ts) reads the factor count and then the plugin deletes, with no lock: two simultaneous deletes by a required user with two passkeys and no app could leave no factor. It heals into enrolment at the next request, so nothing is bypassed. **Not changed here** (auth API code, asked first); follow-up for STATUS.
  4. ADR wording: server rendering loads `qrcode`'s Node entry; the ADR said the list keeps "device type". Both fixed. Also added PK11/PK12 (the login page's passkey sign-in: calls through /api/auth only, and the words for an unknown passkey, a refused one and the per-IP limit).
- **Round 2** (a new fresh reviewer, whole diff 29e8d42..c9d6368): **PASS, nothing blocking.** Notes: (1) the `mfa_required` words suggested setting up the authenticator app, which the product does not offer once a passkey exists. Fixed: "Add another passkey first, then remove this one." (PK7, DP4, passkeys.spec.ts). (2) A session older than 10 minutes learns it only after the password and name. Fixed in words: the Add dialog says up front that a passkey can be added in the first 10 minutes after signing in; checking the session age before asking for the password would need a new read (left as is). (3) Names are unbounded on the server: Q2, already recorded.
- **Round 3** (a new fresh reviewer, whole diff 29e8d42..f3b30cf): **PASS, nothing blocking.** Notes: (1) a server code named like an object property (`constructor`) would have looked up a function as words. Fixed: `Object.hasOwn` (PK14). (2) No screen test of the "password check ran out" return. Added to passkeys.spec.ts at enrolment (back to the password with Passkey still chosen) and in the Add dialog, by answering one `generate-register-options` with 403 `password_confirmation_required` through `page.route`; the call-order check now reads the last calls. (3) `qrcode`'s install-only dependencies (`yargs`, `pngjs` and others) in the lockfile, already in ADR 0060; nothing to do.
- **Round 4** (a new fresh reviewer, whole diff 29e8d42..40b289a): **PASS, nothing blocking.** Notes: (1) removing or renaming a passkey needs no password and removal sends no email (API, unchanged): owner question Q5. (2) A failed re-read after a passkey change swapped the page for the error box and closed the open dialog. Fixed: `keepDataOnError` on the page's read. (3) No test that the login page hides "Sign in with a passkey" without WebAuthn. Added to passkeys.spec.ts (`window.PublicKeyCredential` removed before load).
- **Round 5** (a new fresh reviewer, whole diff 29e8d42..8cac51a): **PASS, nothing blocking.** Notes: (1) the passkey sign-in and the passkey-done step showed any `Error`'s own text (say a JSON parse error) after the session read. Fixed: `failureWords` there, and `fetchSessionContext` and `openCompany` now throw an `ApiError` with the mapped words, so those words still show (PK15). (2) A credential the browser made before `verify-registration` was refused stays on the device; harmless, recorded in ADR 0060 (`signalUnknownCredential` left for later).
- **Round 6** (a new fresh reviewer, whole diff 29e8d42..2b8f8d1): **PASS, nothing blocking, no security note.** One cosmetic note: the suggested name read Chrome and Firefox on iOS (`CriOS`, `FxiOS`) as Safari. Fixed, with PK10 extended. A small UI-only fix, so no further round was run.

## Checks

| Check | Result |
| --- | --- |
| `pnpm lint`, `pnpm typecheck`, `pnpm test` (repo-wide, Turborepo) | all green (6/6, 6/6, 5/5 tasks) |
| Web unit tests (vitest) | 69 files, 499 tests passed (new: webauthn WA1-10, qr-matrix QR1-3, passkeys-api PK1-15, demo-passkeys DP1-5; api-rereads classifies the 5 new methods) |
| Prettier on changed files | clean |
| API integration | not run: the API does not change (its mfa.int.test.ts already covers the rules) |
| api-mode Playwright (`passkeys.spec.ts`, `login.spec.ts`) | written; not run yet: ports 3000/4000 are shared, waiting for the hand-over |
| demo Playwright (`account-security.spec.ts`, screens list for a11y, responsive, console) | written; not run yet, same reason |

## For STATUS

- **Passkey screens with the QR code** (queue item 2), branch `feat/auth-passkey-screens`, stacked on #66; ADR 0060. Api-mode login: Sign in with a passkey. MFA set-up: authenticator app (QR code drawn locally with `qrcode` 1.5.4) or a passkey (the password through `/verify-password` first). New page Sign-in and security (`/account/security`, avatar menu, both products and modes): two-step state, list, add, rename and remove passkeys. No API change. Six security review rounds, the last with no security note.
- **Owner questions (defaults taken):** Q1 no feature switch for the page; Q2 bound passkey names on the API (60 on screen only today); Q3 set up the authenticator app from the security page (not built); Q4 ADR number 0060; Q5 a password and an email for removing a passkey (API unchanged).
- **Follow-ups:** API: `checkNoDowngrade` (auth-hooks.ts) can be raced by two simultaneous passkey deletes of a required user with no app, leaving no factor until the next request sends them to enrolment; serialise deletes per user. Web: tell the browser to forget a credential whose registration the API refused (`signalUnknownCredential`) once support is wider; older login code still shows a raw `Error.message` in places (`failureWords` exists now).

## Reviewer summary

Security review (six fresh read-only `security-reviewer` rounds on 29e8d42..HEAD; the last: **PASS, nothing blocking, no security note**).

- Every auth call (verify-password, the passkey register, list, rename and delete calls, and the passkey sign-in) goes through `/api/auth` by way of `HttpTransport.auth()`, the one route the proxy vouches for; `/auth/context` stays on `/api-proxy`. The verbs match `@better-auth/passkey` 1.7.22.
- Adding a passkey always confirms the password first (`/verify-password`, at enrolment and in the Add dialog); `verify-registration` sends `{ response, name }` and never `createSession`. The API enforces the fresh session, the 5-minute same-session proof, user verification, `mfa_required` and `passkey_required` on its own.
- No tenant or user id comes from the client; passkey ids are ownership-checked by the plugin. The list keeps only id, name, date added and backed-up.
- The `otpauth://` secret is drawn locally as a React SVG path from `qrcode`'s matrix: no innerHTML, data URL, network, storage or logging. `qrcode` 1.5.4 is pinned, has no install scripts, and its CLI dependencies stay out of the browser bundle (ADR 0060).
- The WebAuthn base64url and JSON conversion matches the plugin's client; browser errors and API refusals are shown in fixed plain words by name or code (own-property lookup); the per-IP limit and the account lock are told apart.
- The demo's simulated passkeys cannot be reached in api mode (all five methods are routed; the re-read test classifies them).
- Fixed along the way: stuck buttons on non-API failures, a way back from Passkey to the app at enrolment, the expired password check returning to the password step (e2e), `mfa_required` words, the 10-minute rule said up front, a page kept on a failed re-read, the passkey button hidden without WebAuthn (e2e), plain words after a passkey sign-in.
- Recorded, not changed here: the API-side `checkNoDowngrade` race on simultaneous deletes; passkey names unbounded on the server (Q2); remove and rename needing only a session, with no email on removal (Q5).
