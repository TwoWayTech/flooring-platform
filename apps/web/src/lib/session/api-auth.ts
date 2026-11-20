import { apiErrorCode, ApiError } from "@/lib/api/errors";
import { HttpTransport } from "@/lib/api/http/transport";
import type { SessionContext } from "./api-context";
import { API_PROXY_PATH, AUTH_BASE_PATH } from "./auth-cookie";
import { signInWithPasskeyOn } from "./passkeys";

/**
 * What a sign-in attempt led to. `second-factor`: the password was right and the account has an
 * authenticator app, so the code comes next (no session until then).
 */
export type SignInResult =
  { kind: "signed-in" } | { kind: "second-factor" } | { kind: "verify-email" } | { kind: "refused"; message: string };

/** The outcome of a call that either works or is refused with a message for the person. */
export type AuthStep = { ok: true } | { ok: false; message: string };

/** What starting authenticator-app set-up returns: the otpauth link and the one-time backup codes. */
export interface TotpEnrolment {
  totpURI: string;
  backupCodes: string[];
}

/** Where the verification email's link lands once the address is confirmed. */
export const VERIFIED_CALLBACK = "/login?verified=1";

const NETWORK_MESSAGE = "The server could not be reached. Check your connection and try again.";

/** Messages for Better Auth's codes, in the product's voice (design brief, "Copy"). */
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "That email and password do not match. Check them and try again.",
  INVALID_EMAIL: "Enter your email address, such as name@company.com.",
  INVALID_PASSWORD: "That password is not right. Check it and try again.",
  INVALID_CODE: "That code did not work. Enter the current code from your authenticator app.",
  INVALID_BACKUP_CODE: "That backup code did not work, or it was already used.",
  ACCOUNT_TEMPORARILY_LOCKED: "Too many wrong codes. Try again in 15 minutes.",
};

const RATE_LIMITED_MESSAGE = "Too many attempts from this network. Wait a minute, then try again.";

interface ErrorBody {
  code?: string;
  message?: string;
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function errorBody(response: Response): Promise<ErrorBody> {
  return (await response.json().catch(() => ({}))) as ErrorBody;
}

function messageFor(body: ErrorBody): string {
  return (body.code ? MESSAGES[body.code] : undefined) ?? body.message ?? "Sign-in failed. Try again.";
}

/**
 * The person-facing message for a refused auth call. Better Auth's per-IP limit answers 429 with no
 * code, mapped to `rate_limited` as in docs/api-contract.md; the account lock has its own message.
 */
async function refusal(response: Response): Promise<string> {
  const body = await errorBody(response);
  if (response.status === 429 && !body.code) return RATE_LIMITED_MESSAGE;
  return messageFor(body);
}

/** Posts to an auth endpoint and reports whether it worked, with the message when it did not. */
async function step(path: string, body: unknown): Promise<AuthStep> {
  try {
    const response = await post(`${AUTH_BASE_PATH}${path}`, body);
    return response.ok ? { ok: true } : { ok: false, message: await refusal(response) };
  } catch {
    return { ok: false, message: NETWORK_MESSAGE };
  }
}

/**
 * Signs in with email and password through Better Auth (proxied, so the cookie is first-party).
 * An unverified address gets a fresh verification email and the "check your email" step; an
 * account with an authenticator app is asked for its code next.
 */
export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  try {
    const response = await post(`${AUTH_BASE_PATH}/sign-in/email`, { email, password, callbackURL: VERIFIED_CALLBACK });
    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { twoFactorRedirect?: boolean };
      return body.twoFactorRedirect ? { kind: "second-factor" } : { kind: "signed-in" };
    }
    if (response.status === 403) {
      const body = await errorBody(response.clone());
      if (body.code === "EMAIL_NOT_VERIFIED") return { kind: "verify-email" };
    }
    return { kind: "refused", message: await refusal(response) };
  } catch {
    return { kind: "refused", message: NETWORK_MESSAGE };
  }
}

/** The signed-in user's context from apps/api; throws when the session is missing or ended. */
export async function fetchSessionContext(): Promise<SessionContext> {
  const response = await fetch(`${API_PROXY_PATH}/auth/context`, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new ApiError(messageFor(await errorBody(response)));
  return (await response.json()) as SessionContext;
}

/** Opens one of the user's companies in the session; the API refuses a company they do not belong to. */
export async function openCompany(companyId: string): Promise<void> {
  const response = await post(`${AUTH_BASE_PATH}/organization/set-active`, { organizationId: companyId });
  if (!response.ok) throw new ApiError(messageFor(await errorBody(response)));
}

/** Ends the real session. */
export async function signOutOfApi(): Promise<void> {
  await post(`${AUTH_BASE_PATH}/sign-out`, {});
}

/**
 * Signs in with a passkey: the browser's prompt, checked by the API. A passkey needs user
 * verification, so it is the whole sign-in with no code after it (ADR 0029, part 2; ADR 0060). A
 * required user whose only factor is a passkey must sign in this way (`passkey_required`).
 */
export async function signInWithPasskey(): Promise<AuthStep> {
  try {
    await signInWithPasskeyOn(new HttpTransport(AUTH_BASE_PATH));
    return { ok: true };
  } catch (failure) {
    if (apiErrorCode(failure) === "PASSKEY_NOT_FOUND") return { ok: false, message: UNKNOWN_PASSKEY_MESSAGE };
    return { ok: false, message: failure instanceof ApiError ? failure.message : "Sign-in failed. Try again." };
  }
}

const UNKNOWN_PASSKEY_MESSAGE =
  "That passkey does not belong to an account here. Choose another passkey, or sign in with your password.";

/**
 * Finishes a sign-in with the second factor: the authenticator code, or one of the backup codes.
 * Devices are never remembered, so every sign-in asks (ADR 0029, part 2).
 */
export async function verifySecondFactor(code: string, kind: "totp" | "backup"): Promise<AuthStep> {
  return step(kind === "totp" ? "/two-factor/verify-totp" : "/two-factor/verify-backup-code", { code });
}

/**
 * Starts authenticator-app set-up for the signed-in user; the password is asked again (blueprint
 * p27). The backup codes are shown once, so the screen must show them now.
 */
export async function startTotpEnrolment(password: string): Promise<TotpEnrolment | { message: string }> {
  try {
    const response = await post(`${AUTH_BASE_PATH}/two-factor/enable`, { password });
    if (!response.ok) return { message: await refusal(response) };
    return (await response.json()) as TotpEnrolment;
  } catch {
    return { message: NETWORK_MESSAGE };
  }
}

/** Confirms set-up with the first code from the app; from then on every sign-in asks for a code. */
export async function confirmTotpEnrolment(code: string): Promise<AuthStep> {
  return step("/two-factor/verify-totp", { code });
}

/**
 * Asks for a password-reset email. The answer is the same whether or not the address has an
 * account, and the API sends at most 3 such emails an hour per address (draft spec).
 */
export async function requestPasswordReset(email: string): Promise<AuthStep> {
  return step("/request-password-reset", { email, redirectTo: `${window.location.origin}/reset-password` });
}

/** Sets a new password with the token from the reset link; every session of the account ends. */
export async function resetPassword(token: string, newPassword: string): Promise<AuthStep> {
  return step("/reset-password", { token, newPassword });
}

/** What the accept-invitation page shows before the person chooses a password. */
export interface InvitationInfo {
  email: string;
  companyName: string;
  needsPassword: boolean;
}

/** The invitation behind an emailed token, or the reason it cannot be used. */
export async function fetchInvitation(token: string): Promise<InvitationInfo | { message: string }> {
  try {
    const response = await fetch(`${API_PROXY_PATH}/public/invitations/${encodeURIComponent(token)}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    return response.ok ? ((await response.json()) as InvitationInfo) : { message: await refusal(response) };
  } catch {
    return { message: NETWORK_MESSAGE };
  }
}

/** Accepts an invitation, setting the password of a new account. */
export async function acceptInvitation(token: string, password: string | undefined): Promise<AuthStep> {
  try {
    const response = await post(`${API_PROXY_PATH}/public/invitations/accept`, { token, password });
    return response.ok ? { ok: true } : { ok: false, message: await refusal(response) };
  } catch {
    return { ok: false, message: NETWORK_MESSAGE };
  }
}
