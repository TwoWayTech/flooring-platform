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
