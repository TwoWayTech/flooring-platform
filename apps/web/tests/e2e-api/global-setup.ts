import { removePlatformAdmin, removeSupportGrants, resetAuthState } from "@workspace/db/testing";
import { OWNER_EMAIL, SEEDED_EMAILS } from "./accounts";

/**
 * Starts every run of the real sign-in tests from the same place: the seeded accounts have no
 * authenticator app, passkey, session or failed attempts, and no per-IP limit is in force. Uses the
 * control database the API uses (CONTROL_DATABASE_URL, from the root .env locally and from CI).
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env.CONTROL_DATABASE_URL;
  if (!url) throw new Error("Set CONTROL_DATABASE_URL to the control database the API uses.");
  await resetAuthState(url, SEEDED_EMAILS);
  // A run that crashed may have left its platform admin behind (platform-admin.spec.ts).
  await removePlatformAdmin(url, OWNER_EMAIL);
  // ...and its support requests, which the open-grant and 24-hour limits would count (platform-support.spec.ts).
  await removeSupportGrants(url, OWNER_EMAIL);
}
