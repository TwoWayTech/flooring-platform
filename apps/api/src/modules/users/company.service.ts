import { ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import { branches, userProfiles } from "@workspace/db/company";
import { tenants, user } from "@workspace/db/control";
import {
  directoryOf,
  seesCeiling,
  seesDisabledPeople,
  type CompanyAnswer,
  type CompanyPerson,
} from "@workspace/shared";
import { eq, inArray, isNull } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import { PERMISSION_REFUSALS } from "../../core/access/permission.guard";
import { CONTROL_DB } from "../../core/database/control-db";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { loadRoles, roleView } from "./role-records";
import { UsersService } from "./users.service";

/**
 * `GET /company` (ADR 0051, "GET /company"; spec settings-and-permissions.md, Real build, "The shell
 * on the API"): the open company's facts, the caller's own profile and held roles, the guard's own
 * access and a names directory. It reads only the session's company (TenantGuard's tenant) and
 * writes nothing. Ten light queries: the tenant row, branches, the caller's profile, account,
 * passkeys and held roles, the people's profiles and names, and the roles with their keys.
 */
@Injectable()
export class CompanyService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly users: UsersService,
  ) {}

  /**
   * The answer for the request's person. `access` is PermissionGuard's own for this request, never
   * resolved again, so what the shell shows can't drift from what the API allows (D3). The ceiling
   * goes only to someone who `seesCeiling` (D4); roles only the person holds.
   */
  async answer(tenant: TenantContext, access: RequestAccess): Promise<CompanyAnswer> {
    const db = await this.tenancy.db(tenant);
    const [company, branchRows, me, people, roles] = await Promise.all([
      this.tenantRow(tenant.companyId),
      db
        .select({ id: branches.id, name: branches.name, city: branches.city, state: branches.state })
        .from(branches)
        .where(isNull(branches.deletedAt))
        .orderBy(branches.name),
      this.users.one(tenant, access.userId),
      this.people(
        db,
        seesDisabledPeople((key) => access.permissions.has(key)),
      ),
      loadRoles(db),
    ]);
    // A profile without a control account holds nothing here: the guard's own words, nothing else.
    if (!me) throw new ForbiddenException({ code: "forbidden", message: PERMISSION_REFUSALS.forbidden });
    return {
      company: {
        id: tenant.companyId,
        ...company,
        modules: [...access.modules],
        ceiling: seesCeiling((key) => access.permissions.has(key)) ? [...access.ceiling].sort() : null,
        branches: branchRows,
      },
      me,
      roles: roles.filter((role) => me.roleIds.includes(role.id)).map((role) => roleView(role, tenant.companyId)),
      access: { permissions: [...access.permissions].sort(), dataScope: access.dataScope, isOwner: access.isOwner },
      people,
    };
  }

  /** The open company's control row: name, place and time zone. */
  private async tenantRow(companyId: string) {
    const [row] = await this.control.db
      .select({
        slug: tenants.slug,
        name: tenants.name,
        city: tenants.city,
        state: tenants.state,
        timeZone: tenants.timeZone,
      })
      .from(tenants)
      .where(eq(tenants.id, companyId));
    // TenantContext is built from this row, so a missing one is a fault (as `companyClock` says).
    if (!row) throw new Error(`Company ${companyId} has no control row.`);
    return row;
  }

  /**
   * Every live profile with an account, as a name beside a record (D5): only the profile's id and
   * status and the account's name are read, and `directoryOf` leaves invited people out, and
   * disabled ones unless the caller reads Settings → Users (ADR 0051, "2026-11-20").
   */
  private async people(db: CompanyDb, seesDisabled: boolean): Promise<CompanyPerson[]> {
    const profiles = await db
      .select({ userId: userProfiles.userId, status: userProfiles.status })
      .from(userProfiles)
      .where(isNull(userProfiles.deletedAt));
    if (profiles.length === 0) return [];
    const names = await this.control.db
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(
        inArray(
          user.id,
          profiles.map((profile) => profile.userId),
        ),
      );
    return directoryOf(
      profiles.flatMap((profile) => {
        const account = names.find((row) => row.id === profile.userId);
        return account ? [{ id: profile.userId, name: account.name, status: profile.status }] : [];
      }),
      seesDisabled,
    );
  }
}
