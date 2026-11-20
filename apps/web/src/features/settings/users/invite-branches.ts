import type { Access, Branch, User } from "@workspace/shared";

/**
 * The branches an inviter may pick and the one picked first (ADR 0051, "GET /company", D18): every
 * branch for someone whose data scope is `all`, otherwise only their own, and their own branch first
 * when it is listed, and whether they can invite at all. This only keeps the screen from offering a branch a branch-scoped admin
 * can't pick; the API and DemoStore refuse it anyway (`branchPlacementDenial`, ADR 0051 "2026-11-20").
 * An empty id is no branch.
 */
export function inviteBranches(
  branches: readonly Branch[],
  inviter: Pick<User, "branchId">,
  access: Pick<Access, "dataScope">,
): { branches: Branch[]; defaultId: string; canInvite: boolean } {
  const own = branches.find((branch) => branch.id === inviter.branchId);
  const listed = access.dataScope === "all" ? [...branches] : own ? [own] : [];
  const first = own && listed.includes(own) ? own : listed[0];
  // Below scope `all` the API takes only the inviter's own branch, so without one nobody can be invited.
  return { branches: listed, defaultId: first?.id ?? "", canInvite: access.dataScope === "all" || own !== undefined };
}
