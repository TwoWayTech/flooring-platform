import { describe, expect, it } from "vitest";
import { alertPhrase, failureLine, reportMigrationFailure } from "../scripts/migrate-report";

const TENANT = "0195f3a2-7b1c-7d4e-8f00-1234567890ab";

/**
 * The line pnpm db:migrate prints for a failed company (docs/specs/platform-admin.md, "How pnpm
 * db:migrate handles a failure"; AC34; ADR 0053), including when the alert itself fails.
 */
describe("migrate script failure line", () => {
  it("counts the admins emailed, and says NOT emailed for the memory adapter or a failed alert", () => {
    expect(alertPhrase(2, true)).toBe("2 platform admin(s) emailed");
    expect(alertPhrase(2, false)).toBe("2 platform admin(s) NOT emailed (EMAIL_PROVIDER is memory)");
    expect(alertPhrase(null, true)).toBe("0 platform admin(s) NOT emailed (the alert failed)");
    expect(alertPhrase(null, false)).toBe("0 platform admin(s) NOT emailed (the alert failed)");
  });

  it("says where the company stands and what to do by hand when it is NOT in maintenance", () => {
    const alert = "1 platform admin(s) emailed";
    expect(failureLine({ tenantId: TENANT, maintenance: true, readOnly: true }, alert)).toBe(
      `Company ${TENANT} is in maintenance mode; 1 platform admin(s) emailed.`,
    );
    expect(failureLine({ tenantId: TENANT, maintenance: false, readOnly: true }, alert)).toBe(
      `Company ${TENANT} is NOT in maintenance mode and its read-only database still serves reads: turn it on by hand (tenants.maintenance_mode, reason migration_failed); 1 platform admin(s) emailed.`,
    );
    expect(failureLine({ tenantId: TENANT, maintenance: false, readOnly: false }, alert)).toBe(
      `Company ${TENANT} is NOT in maintenance mode: turn it on by hand (tenants.maintenance_mode, reason migration_failed); 1 platform admin(s) emailed.`,
    );
  });

  it("prints the line after a sent alert", async () => {
    const printed: string[] = [];
    await reportMigrationFailure(
      { tenantId: TENANT, maintenance: true, readOnly: false },
      true,
      async () => 3,
      (line) => printed.push(line),
    );
    expect(printed).toEqual([`Company ${TENANT} is in maintenance mode; 3 platform admin(s) emailed.`]);
  });

  it("still says NOT in maintenance when the alert throws, as with an unreachable control database", async () => {
    const printed: string[] = [];
    const unreachable = new Error("connect ECONNREFUSED");
    await expect(
      reportMigrationFailure(
        { tenantId: TENANT, maintenance: false, readOnly: true },
        true,
        async () => {
          throw unreachable;
        },
        (line) => printed.push(line),
      ),
    ).rejects.toBe(unreachable);
    expect(printed).toEqual([
      `Company ${TENANT} is NOT in maintenance mode and its read-only database still serves reads: turn it on by hand (tenants.maintenance_mode, reason migration_failed); 0 platform admin(s) NOT emailed (the alert failed).`,
    ]);
  });
});
