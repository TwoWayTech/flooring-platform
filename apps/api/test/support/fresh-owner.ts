import { member, user, userInvitations } from "@workspace/db/control";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { INVITATION_DAYS, newInvitationToken, tokenHash } from "../../src/modules/users/invitation-rules";
import { PASSWORD, type AuthHarness } from "../auth-harness";

/** A provisioned company's Owner: their user id and sign-in email. */
export interface ProvisionedOwner {
  userId: string;
  email: string;
}

/** A provisioned company's Owner and the invitation link token a test holds for them. */
export interface OwnerInvitation extends ProvisionedOwner {
  token: string;
}

/**
 * The Owner `provisionTenant` made for a company, read from the harness's control database:
 * provisioning makes exactly one member, the Owner, so a second member here means the company was
 * changed before the test looked.
 */
export async function provisionedOwner(harness: AuthHarness, companyId: string): Promise<ProvisionedOwner> {
  const owners = await harness.control.db
    .select({ userId: member.userId, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, companyId));
  expect(owners).toHaveLength(1);
  return owners[0];
}

/**
 * Inserts the invitation that provisioning should send its Owner and doesn't yet (gap G4; STATUS
 * "Provisioning sends the owner's invitation with the platform-admin screens (P17)"): a
 * `user_invitations` row holding only the token's SHA-256, valid for the product's 7 days, exactly
 * as `UsersService.invite` writes one. The Owner then sets a password through the product's real
 * acceptance (`acceptInvitation`), so no test code writes a credential. Test-only: it reaches the
 * harness's throwaway control database directly.
 */
export async function inviteProvisionedOwner(harness: AuthHarness, companyId: string): Promise<OwnerInvitation> {
  const owner = await provisionedOwner(harness, companyId);
  const token = newInvitationToken();
  await harness.control.db.insert(userInvitations).values({
    tenantId: companyId,
    userId: owner.userId,
    tokenHash: tokenHash(token),
    expiresAt: new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000),
    createdBy: owner.userId,
  });
  return { ...owner, token };
}

/** Accepts an invitation through `POST /public/invitations/accept` with the shared test password; 204 expected. */
export async function acceptInvitation(harness: AuthHarness, token: string): Promise<void> {
  await harness.post("/public/invitations/accept").send({ token, password: PASSWORD }).expect(204);
}

/**
 * The token of the invitation link the API emailed to this address (`POST /users/invite`), read
 * from the harness's memory email adapter: the link's `token` parameter, as the accept page reads
 * it. Fails the test when no such email was sent.
 */
export function invitationTokenFor(harness: AuthHarness, email: string): string {
  const message = harness.outbox.sent.find((sent) => sent.to.includes(email));
  const link = /https?:\/\/\S+/.exec(message?.text ?? "")?.[0];
  const token = link ? new URL(link).searchParams.get("token") : null;
  expect(token, `no invitation link was emailed to ${email}`).toBeTruthy();
  return token!;
}
