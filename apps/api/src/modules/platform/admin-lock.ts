import { ForbiddenException } from "@nestjs/common";
import type { ControlDb } from "@workspace/db";
import { platformAdmins } from "@workspace/db/control";
import { isPlatformAdminRole, type PlatformAdminRole } from "@workspace/shared";
import { and, eq, isNull } from "drizzle-orm";
import { PLATFORM_REFUSALS } from "./platform-admin.guard";

/**
 * Locks the acting admin's own `platform_admins` row for the rest of the transaction and checks it
 * again (docs/specs/platform-admin.md, part 3 "What a request does", step 1 and "Why a row lock";
 * part 2 "Who may call what (part 2)"; ADR 0053 and ADR 0056). Every platform write that needs it
 * calls this first, so the lock order is always the admin's row, then the company or plan row.
 * - Two parallel writes by one admin both pass the guard, because a step-up isn't used up; the row
 *   is unique per user, so the lock serialises them with no new table or key.
 * - The guard's plain reads are not blocked. Under READ COMMITTED the locked row is read again
 *   after another transaction that held it commits, so an admin deactivated, deleted or given a
 *   role the console doesn't accept while waiting gets 403 `not_admin`, and one moved to a role the
 *   route doesn't allow (`roles`) gets 403 `owner_only`. Nothing is written either way.
 */
export async function lockActingAdmin(
  tx: ControlDb,
  userId: string,
  roles: readonly PlatformAdminRole[],
): Promise<void> {
  const [row] = await tx
    .select({ role: platformAdmins.role })
    .from(platformAdmins)
    .where(and(eq(platformAdmins.userId, userId), eq(platformAdmins.active, true), isNull(platformAdmins.deletedAt)))
    .for("update");
  if (!row || !isPlatformAdminRole(row.role)) {
    throw new ForbiddenException({ code: "forbidden", message: PLATFORM_REFUSALS.not_admin });
  }
  if (!roles.includes(row.role)) {
    throw new ForbiddenException({ code: "forbidden", message: PLATFORM_REFUSALS.owner_only });
  }
}
