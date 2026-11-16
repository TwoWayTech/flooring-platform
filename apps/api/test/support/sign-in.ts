import type { AuthHarness } from "../auth-harness";
import { platformHelpers, type EnrolledAdmin } from "./platform-admins";

/** A signed-in person with an enrolled authenticator app: their session cookie and TOTP secret. */
export type EnrolledPerson = EnrolledAdmin;

/**
 * Signs in a person whose roles need MFA (Owner, Accountant, HR; blueprint p27), enrols an
 * authenticator app and returns the enrolled session. It is the platform tests' sign-in, reused
 * under a neutral name for the whole-product check, so the steps exist once.
 */
export function enrolled(harness: AuthHarness, email: string): Promise<EnrolledPerson> {
  return platformHelpers(harness).enrolled(email);
}

/** A step-up with a fresh code, so the person's next step-up-protected write is allowed (ADR 0029). */
export function stepUp(harness: AuthHarness, who: Pick<EnrolledPerson, "cookie" | "secret">): Promise<void> {
  return platformHelpers(harness).stepUp(who);
}
