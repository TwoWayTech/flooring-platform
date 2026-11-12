import type { SessionContext } from "./api-context";
import { API_PROXY_PATH, AUTH_BASE_PATH } from "./auth-cookie";

/** What a sign-in attempt led to. */
export type SignInResult = { kind: "signed-in" } | { kind: "verify-email" } | { kind: "refused"; message: string };

/** Where the verification email's link lands once the address is confirmed. */
export const VERIFIED_CALLBACK = "/login?verified=1";

const NETWORK_MESSAGE = "The server could not be reached. Check your connection and try again.";

/** Messages for Better Auth's codes, in the product's voice (design brief, "Copy"). */
const MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "That email and password do not match. Check them and try again.",
  INVALID_EMAIL: "Enter your email address, such as name@company.com.",
};

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
 * Signs in with email and password through Better Auth (proxied, so the cookie is first-party).
 * An unverified address gets a fresh verification email and the "check your email" step.
 */
export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  try {
    const response = await post(`${AUTH_BASE_PATH}/sign-in/email`, { email, password, callbackURL: VERIFIED_CALLBACK });
    if (response.ok) return { kind: "signed-in" };
    const body = await errorBody(response);
    if (body.code === "EMAIL_NOT_VERIFIED") return { kind: "verify-email" };
    return { kind: "refused", message: messageFor(body) };
  } catch {
    return { kind: "refused", message: NETWORK_MESSAGE };
  }
}

/** The signed-in user's context from apps/api; throws when the session is missing or ended. */
export async function fetchSessionContext(): Promise<SessionContext> {
  const response = await fetch(`${API_PROXY_PATH}/auth/context`, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) throw new Error(messageFor(await errorBody(response)));
  return (await response.json()) as SessionContext;
}

/** Opens one of the user's companies in the session; the API refuses a company they do not belong to. */
export async function openCompany(companyId: string): Promise<void> {
  const response = await post(`${AUTH_BASE_PATH}/organization/set-active`, { organizationId: companyId });
  if (!response.ok) throw new Error(messageFor(await errorBody(response)));
}

/** Ends the real session. */
export async function signOutOfApi(): Promise<void> {
  await post(`${AUTH_BASE_PATH}/sign-out`, {});
}
