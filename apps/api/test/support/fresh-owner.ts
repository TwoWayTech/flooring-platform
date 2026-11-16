import { member, user, userInvitations } from "@workspace/db/control";
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { INVITATION_DAYS, newInvitationToken, tokenHash } from "../../src/modules/users/invitation-rules";
import { PASSWORD, type AuthHarness } from "../auth-harness";

/** A provisioned company's Owner and the invitation link token a test holds for them. */
export interface OwnerInvitation {
  email: string;
  userId: string;
  token: string;
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
  const owners = await harness.control.db
    .select({ userId: member.userId, email: user.email })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, companyId));
  // provisionTenant makes exactly one member: the Owner.
  expect(owners).toHaveLength(1);
  const [owner] = owners;
  const token = newInvitationToken();
  await harness.control.db.insert(userInvitations).values({
    tenantId: companyId,
    userId: owner!.userId,
    tokenHash: tokenHash(token),
    expiresAt: new Date(Date.now() + INVITATION_DAYS * 24 * 60 * 60 * 1000),
    createdBy: owner!.userId,
  });
  return { email: owner!.email, userId: owner!.userId, token };
}

/** Accepts an invitation through `POST /public/invitations/accept` with the shared test password; 204 expected. */
export async function acceptInvitation(harness: AuthHarness, token: string): Promise<void> {
  await harness.post("/public/invitations/accept").send({ token, password: PASSWORD }).expect(204);
}
