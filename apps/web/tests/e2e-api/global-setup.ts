import {
  clearTestStanding,
  clearTestStatus,
  removePlatformAdmin,
  removeSupportGrants,
  removeTestPlans,
  removeTestSupportAgent,
  resetAuthState,
} from "@workspace/db/testing";
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
  // ...and the test-only support requester and its grants (company-standing.spec.ts).
  await removeTestSupportAgent(url);
  // A crashed run may have left Summit in maintenance or past its period; only toward full use, and logged.
  const changed = await clearTestStanding(url, "summit");
  if (changed.length > 0) console.info(`global-setup: Summit's standing was reset: ${changed.join("; ")}.`);
  // ...and a suspended or cancelled Summit, or an `e2e-` plan, left by platform-billing.spec.ts; toward full use only.
  const statusChanged = await clearTestStatus(url, "summit");
  if (statusChanged.length > 0) console.info(`global-setup: Summit's status was reset: ${statusChanged.join("; ")}.`);
  const plansRemoved = await removeTestPlans(url);
  if (plansRemoved.length > 0) console.info(`global-setup: test plans were removed: ${plansRemoved.join(", ")}.`);
}
