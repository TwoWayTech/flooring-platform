import type { DemoSession } from "./session";

/** What the login page sends: a persona of a company, or the platform admin. */
export type SignInRequest =
  { kind: "company"; companyId: string; userId: string; roleKey: string } | { kind: "platform" };

/** Signs in through POST /api/demo/login; throws with the server's message when refused. */
export async function signIn(request: SignInRequest): Promise<DemoSession> {
  const response = await fetch("/api/demo/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = (await response.json()) as { session?: DemoSession; error?: string };
  if (!response.ok || !body.session) throw new Error(body.error ?? "Sign-in failed. Try again.");
  return body.session;
}

/** Ends the session through POST /api/demo/logout. */
export async function signOutRequest(): Promise<void> {
  await fetch("/api/demo/logout", { method: "POST" });
}
