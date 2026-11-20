# ADR 0060: The passkey screens and the authenticator QR code (`qrcode` 1.5.4)

- **Status:** accepted, 2026-11-20, on branch `feat/auth-passkey-screens` (stacked on PR #66). The owner approved the passkey screens and the `qrcode` library on 2026-11-20 (docs/STATUS.md, "Owner's answers"; docs/blueprint-delta.md, the 2026-11-20 row), with registration calling `/verify-password` first. Session log docs/sessions/2026-11-20-1516-a-passkey-screens.md.
- **Context:**
  - ADR 0029 part 2 built TOTP, backup codes and passkeys on the API (Better Auth's `twoFactor` and `@better-auth/passkey` 1.7.22), with the password asked again before a passkey is added (`/verify-password`, 5 minutes, same session, a sign-in at most 10 minutes old), no new session from a registration, an email when one is added, user verification required, and no removal of a required user's last factor (403 `mfa_required`). Its web part had only the code step and the authenticator set-up with the setup key typed by hand: "Passkey screens and a QR code are B's".
  - Without a passkey sign-in on the login page, a required user whose only factor is a passkey cannot sign in at all: the password sign-in answers 403 `passkey_required`.
  - apps/web has no Better Auth client. Every auth call is a plain `fetch` to `/api/auth/*` through the web host's proxy, which adds the client IP and the proxy secret (lib/session/api-auth.ts, auth-proxy.ts).

## Decision

### 1. The QR code: `qrcode` 1.5.4, in apps/web only

| Library       | Version            | Where          | Why                                                                                                                                    |
| ------------- | ------------------ | -------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| qrcode        | 1.5.4 (2024-08-05) | apps/web       | Draws the authenticator app's `otpauth://` link as a QR code on the set-up step, so a phone scans it instead of typing a 32-letter key |
| @types/qrcode | 1.5.6 (2025-10-24) | apps/web (dev) | Its types                                                                                                                              |

- Only `QRCode.create` is used: it returns the module matrix, which `QrCode` (`features/login/qr-code.tsx`) draws as one SVG path with React. No `innerHTML`, no canvas, no data URL, no network. The secret and the link are never logged, stored or sent anywhere; they live in the set-up step's state only, as before.
- Error correction `M`; a quiet zone of 4 modules; dark modules on a light tile in both themes (`--qr-ink` and `--qr-paper`, the same in light and dark, because many phone scanners do not read inverted codes). The setup key and Copy stay under it for people who cannot scan.
- **Alternatives:** `qrcode-generator` (smaller, no types, last release 2023 for a fork), `react-qr-code` (a React wrapper over a 2016 port, and a second React dependency to track), writing a QR encoder (Reed-Solomon and masking: too easy to get subtly wrong for a security step), an online QR service (sends the secret to a third party: refused). `qrcode` is the most used, has a browser entry with no Node-only code, and its CLI's dependencies (`yargs`, `pngjs`) are never loaded by the browser entry.

### 2. Passkeys without a Better Auth client

- The plugin's own client (`@better-auth/passkey/client`) needs `better-auth`, `nanostores` and `@simplewebauthn/browser` in apps/web; none is approved and the web app has no Better Auth client to plug it into. Instead `lib/session/webauthn.ts` runs the ceremony with the browser's WebAuthn API: it turns the API's JSON options into `navigator.credentials.create` and `get` arguments (base64url to bytes), and the credential back into the same JSON body the plugin's client sends (`{ response: { id, rawId, type, response: { clientDataJSON, attestationObject | authenticatorData + signature + userHandle, transports }, authenticatorAttachment, clientExtensionResults } }`). About 100 lines, unit tested. Browser errors become plain words by name: `NotAllowedError` (cancelled or timed out), `InvalidStateError` (this device already has a passkey for the account), `SecurityError`, no WebAuthn at all.
- `lib/session/passkeys.ts` holds the calls: `verify-password`, `generate-register-options` (with no `name` query, which the plugin would show as the account name in the browser's prompt), `verify-registration` (`{ response, name }`, never `createSession`), `list-user-passkeys` (only id, name, date added, device type and backed-up are kept), `update-passkey`, `delete-passkey`, and the sign-in pair. Every refusal is shown by its code in plain words (`password_confirmation_required`, `mfa_required`, `passkey_required`, `account_locked`, `INVALID_PASSWORD`, the per-IP 429).

### 3. Where the screens are

- **Login (api mode):** "Sign in with a passkey" under the password form. A `passkey_required` refusal shows its words and points to it.
- **Set-up at sign-in (api mode):** the "Set up two-step sign-in" step first asks which: an authenticator app (as before, now with the QR code) or a passkey (the password, then a name, then the browser's prompt). Either finishes enrolment.
- **Sign-in and security** (`/account/security`, from the avatar menu, both products and both modes): whether two-step sign-in is required and on, and the passkeys with Add, Rename and Remove. Add asks for the password every time, then the name and the prompt. Remove asks to confirm. The page reads and writes through the ApiClient (CLAUDE.md rule 1): `signInSecurity`, `confirmPassword`, `addPasskey`, `renamePasskey`, `deletePasskey`. In api mode `API_METHODS` send them to `/api/auth/*`, the one route the proxy vouches for; DemoStore simulates them (any password, no browser prompt, the API's words for removing a required role's last factor).
- **No feature switch.** Signing in is not a module feature; `auth.mfa` stays the demo's simulated code step.

## Consequences

- A required user can now enrol with a passkey and sign in with it; a person can keep more than one passkey and remove a lost one.
- The API does not change. Its tests (mfa.int.test.ts) already cover the password-first rule, `create_session_unsupported`, `passkey_required` and `mfa_required`.
- Passkey names are bounded to 60 characters on screen only; the plugin accepts any length (owner question in the session log).
- Setting up the authenticator app from the security page, for people whose role does not require it, is not built (owner question).
