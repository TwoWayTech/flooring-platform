import { ApiError } from "@/lib/api/errors";
import { HttpApiError, type HttpTransport } from "@/lib/api/http/transport";
import type { SessionContext } from "./api-context";
import {
  createPasskey,
  signWithPasskey,
  type CreationOptionsJSON,
  type CredentialJSON,
  type RequestOptionsJSON,
} from "./webauthn";

/** One of the signed-in person's passkeys, as the security page shows it. */
export interface PasskeySummary {
  id: string;
  name: string;
  /** When it was added, as an ISO timestamp. */
  createdAt: string;
  /** Whether it syncs between the person's devices (a backed-up, multi-device passkey). */
  synced: boolean;
}

/** Where the signed-in person stands on two-step sign-in (blueprint p27; ADR 0029, part 2). */
export interface SignInSecurity {
  /** Their role needs two-step sign-in, so their last factor cannot be removed. */
  mfaRequired: boolean;
  /** The authenticator app is on. */
  totp: boolean;
  passkeys: PasskeySummary[];
}

/** The longest passkey name the screens accept (ADR 0060). */
export const PASSKEY_NAME_MAX = 60;

/** Why a passkey name cannot be saved, or null when it can. */
export function passkeyNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return "Enter a name, such as the device it is on.";
  if (trimmed.length > PASSKEY_NAME_MAX) return `Use ${PASSKEY_NAME_MAX} characters or fewer.`;
  return null;
}

/** A first name for a new passkey from the browser and system, such as "Chrome on Windows". */
export function defaultPasskeyName(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : null;
  const system = /iPhone|iPad/.test(userAgent)
    ? "iPhone or iPad"
    : /Android/.test(userAgent)
      ? "Android"
      : /Mac OS X/.test(userAgent)
        ? "Mac"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "My passkey";
}

/**
 * Words for the auth refusals these screens meet, by code (docs/api-contract.md, Authentication;
 * the design brief's "Copy": what happened and how to fix it).
 */
export const PASSKEY_REFUSALS = {
  INVALID_PASSWORD: "That password is not right. Check it and try again.",
  password_confirmation_required:
    "Your password check has run out. Confirm your password again, then add the passkey within 5 minutes.",
  SESSION_NOT_FRESH:
    "A passkey can be added only in the first 10 minutes after you sign in. Sign out, sign in again, then add it.",
  mfa_required:
    "Your role needs two-step sign-in, so you cannot remove your last passkey. Add another passkey first, then remove this one.",
  passkey_required: "Your account uses a passkey for two-step sign-in. Sign in with your passkey.",
  PASSKEY_NOT_FOUND: "That passkey is no longer on your account. Reload the page to see your passkeys.",
  AUTHENTICATION_FAILED: "That passkey was not accepted. Try again, or sign in with your password.",
  FAILED_TO_VERIFY_REGISTRATION: "The passkey could not be checked. Try again, or use another device.",
  CHALLENGE_NOT_FOUND: "The passkey prompt took too long. Try again.",
  mfa_enrolment_required: "Set up two-step sign-in to continue.",
} as const;
const REFUSAL_WORDS: Readonly<Record<string, string | undefined>> = PASSKEY_REFUSALS;

const RATE_LIMITED = "Too many attempts from this network. Wait a minute, then try again.";

/**
 * The person's words for a failed auth call. The account lock (429 `account_locked`) and the API's
 * own refusals keep its message; Better Auth's per-IP limit is a 429 with no code.
 */
export function authRefusal(failure: unknown): Error {
  if (!(failure instanceof HttpApiError)) return failure instanceof Error ? failure : new ApiError(String(failure));
  const words = REFUSAL_WORDS[failure.code];
  if (words) return new HttpApiError(words, failure.status, failure.code);
  if (failure.status === 429 && failure.code === "error") return new HttpApiError(RATE_LIMITED, 429, "rate_limited");
  return failure;
}

async function refusedAs<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (failure) {
    throw authRefusal(failure);
  }
}

/** A passkey row as `/passkey/list-user-passkeys` answers it; only these fields are kept. */
interface PasskeyRow {
  id: string;
  name?: string | null;
  createdAt?: string | null;
  backedUp?: boolean | null;
}

function summary(row: PasskeyRow): PasskeySummary {
  return {
    id: row.id,
    name: row.name?.trim() || "Unnamed passkey",
    createdAt: row.createdAt ?? "",
    synced: !!row.backedUp,
  };
}

/**
 * Confirms the password before a passkey is added (`POST /verify-password`): it lasts 5 minutes,
 * on this session only, and a wrong one counts towards the sign-in lockout. Changes nothing, so
 * it is sent as a read.
 */
export function confirmPasswordOn(auth: HttpTransport, password: string): Promise<void> {
  return refusedAs(() => auth.requestAsRead<void>("POST", "/verify-password", { password }));
}

/**
 * Adds a passkey to the signed-in account: the API's options, the browser's prompt, then the
 * answer with its name. Needs `confirmPasswordOn` in the last 5 minutes; never asks for a new
 * session; the API emails the account. No `name` query: the plugin would show it as the account
 * name in the browser's prompt.
 */
export async function addPasskeyOn(auth: HttpTransport, name: string): Promise<void> {
  const problem = passkeyNameProblem(name);
  if (problem) throw new ApiError(problem);
  const options = await refusedAs(() => auth.request<CreationOptionsJSON>("GET", "/passkey/generate-register-options"));
  const response = await createPasskey(options);
  await refusedAs(() => auth.request<unknown>("POST", "/passkey/verify-registration", { response, name: name.trim() }));
}

/** The signed-in person's passkeys, oldest first. */
export async function listPasskeysOn(auth: HttpTransport): Promise<PasskeySummary[]> {
  const rows = await refusedAs(() => auth.request<PasskeyRow[]>("GET", "/passkey/list-user-passkeys"));
  return (Array.isArray(rows) ? rows : []).map(summary).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Where the signed-in person stands: their MFA state from `GET /auth/context`, and their passkeys. */
export async function signInSecurityOn(api: HttpTransport): Promise<SignInSecurity> {
  const [context, passkeys] = await Promise.all([
    refusedAs(() => api.request<SessionContext>("GET", "/auth/context")),
    listPasskeysOn(api.auth()),
  ]);
  return { mfaRequired: !!context.mfa?.required, totp: !!context.mfa?.totp, passkeys };
}

/** Renames one of the person's passkeys. */
export async function renamePasskeyOn(auth: HttpTransport, id: string, name: string): Promise<void> {
  const problem = passkeyNameProblem(name);
  if (problem) throw new ApiError(problem);
  await refusedAs(() => auth.request<unknown>("POST", "/passkey/update-passkey", { id, name: name.trim() }));
}

/** Removes one of the person's passkeys; the API refuses a required user's last factor (`mfa_required`). */
export async function deletePasskeyOn(auth: HttpTransport, id: string): Promise<void> {
  await refusedAs(() => auth.request<unknown>("POST", "/passkey/delete-passkey", { id }));
}

/**
 * Signs in with a passkey (no session needed): the API's options, the browser's prompt, then the
 * assertion. A passkey needs user verification, so it is two factors on its own (ADR 0029).
 */
export async function signInWithPasskeyOn(auth: HttpTransport): Promise<void> {
  const options = await refusedAs(() =>
    auth.request<RequestOptionsJSON>("GET", "/passkey/generate-authenticate-options"),
  );
  const response: CredentialJSON = await signWithPasskey(options);
  await refusedAs(() => auth.request<unknown>("POST", "/passkey/verify-authentication", { response }));
}
