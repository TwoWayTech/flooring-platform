import { Inject, Injectable } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { platformAdmins } from "@workspace/db/control";
import { isPlatformAdminRole, type PlatformAdminRole } from "@workspace/shared";
import { and, eq, isNull } from "drizzle-orm";
import { CONTROL_DB } from "../../core/database/control-db";

/**
 * Reads the platform's own admin team from the control database (blueprint p28; docs/specs/
 * platform-admin.md, "Who uses it"). Deny by default: only a row that is active, not deleted and
 * holds a role the console accepts makes someone an admin (review A4), and it is read on every
 * request, so deactivating an admin applies to their next request.
 */
@Injectable()
export class PlatformAdmins {
  constructor(@Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>) {}

  /** The person's console role, or null when they are not a platform admin. */
  async roleOf(userId: string): Promise<PlatformAdminRole | null> {
    const [row] = await this.control.db
      .select({ role: platformAdmins.role })
      .from(platformAdmins)
      .where(and(eq(platformAdmins.userId, userId), eq(platformAdmins.active, true), isNull(platformAdmins.deletedAt)))
      .limit(1);
    return row && isPlatformAdminRole(row.role) ? row.role : null;
  }
}
