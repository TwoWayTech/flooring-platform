import { describe, expect, it } from "vitest";
import { accessDiff, type AccessState, type ModuleOverrideChange } from "../src/platform/access-patch";
import {
  auditActionName,
  auditTargetId,
  auditTargetType,
  FORMER_ADMIN_NAME,
  isPlatformAuditAction,
  MIGRATION_ERROR_CODE,
  MIGRATION_VERSION,
  migrationErrorCode,
  PLATFORM_ADMIN_AUDIT_ACTIONS,
  PLATFORM_AUDIT_ACTIONS,
  PLATFORM_AUDIT_ACTOR,
  PLATFORM_AUDIT_PAGE,
  PLATFORM_AUDIT_QUERY_MESSAGES,
  platformAuditActor,
  platformAuditActorKind,
  platformAuditDetails,
  platformAuditView,
  type PlatformAuditRow,
} from "../src/platform/audit-details";
import { ALL_PERMISSION_KEYS } from "../src/permissions/catalog";

const MARKER = "MARKER-7f3a";
const SUBSCRIPTION = "0196f3a2-7c1d-7e4b-9a10-2b3c4d5e6f70";
const COMPANY = "0196f3a2-7c1d-7e4b-9a10-2b3c4d5e6f71";
const GRANT = "0196f3a2-7c1d-7e4b-9a10-2b3c4d5e6f72";
const ADMIN_OWNER = "0196f3a2-7c1d-7e4b-9a10-2b3c4d5e6f73";
const ADMIN_SUPPORT = "0196f3a2-7c1d-7e4b-9a10-2b3c4d5e6f74";
const COMPANY_OWNER = "0196f3a2-7c1d-7e4b-9a10-2b3c4d5e6f75";
const HIDDEN = { kind: "hidden" };

/** A value as it comes back from a jsonb column. */
function stored<T>(value: T): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** The details of a migration failure whose `after` is `after`. */
function failed(after: unknown, before: unknown = null) {
  return platformAuditDetails("company.migration_failed", before, after);
}

/** A valid `company.access_changed` row: a real diff plus the rows a save wrote. */
function accessRow() {
  const before: AccessState = {
    modules: ["platform", "core", "retail"],
    ceiling: ["settings.users.view", "retail.sample.view"],
    userLimit: 16,
    branchLimit: 3,
  };
  const after: AccessState = {
    modules: ["platform", "core", "wholesale"],
    ceiling: ["settings.users.view", "sales.quote.view"],
    userLimit: 10,
    branchLimit: 3,
  };
  const diff = accessDiff(before, after);
  if (!diff) throw new Error("expected a diff");
  const overrideRows: ModuleOverrideChange[] = [
    { module: "retail", action: "write", enabled: false },
    { module: "meetings", action: "remove" },
  ];
  const limitRows = [{ subscriptionId: SUBSCRIPTION, userLimitOverride: 10, branchLimitOverride: null }];
  return { before: stored(diff.before), after: { ...diff.after, overrideRows, limitRows } };
}

/** The access row with `after` changed by `change`. */
function accessWith(change: (after: Record<string, unknown>) => Record<string, unknown>) {
  const row = accessRow();
  return platformAuditDetails("company.access_changed", row.before, stored(change(row.after)));
}

describe("platformAuditDetails: company.migration_failed (platform-admin spec, Redaction)", () => {
  it("shows an old row that holds the driver's text as no code, and never the text", () => {
    const after = { maintenanceMode: true, error: `duplicate key value violates "users" Key (email)=(${MARKER}@x)` };
    const details = failed(after);
    expect(details).toEqual({ kind: "migration_failed", code: null });
    expect(JSON.stringify(details)).not.toContain(MARKER);
  });

  it("keeps a code that fits the pattern and nothing else", () => {
    expect(failed({ maintenanceMode: true, code: "42P01" })).toEqual({ kind: "migration_failed", code: "42P01" });
    expect(failed({ maintenanceMode: true, code: "ECONNREFUSED", error: MARKER })).toEqual({
      kind: "migration_failed",
      code: "ECONNREFUSED",
    });
  });

  it("gives no code for a junk code or any after that isn't an object", () => {
    for (const after of [
      { code: "42P01; drop" },
      { code: "42p01" },
      { code: "" },
      { code: "A".repeat(33) },
      { code: 42 },
      { code: { x: 1 } },
      { code: ["42P01"] },
      null,
      undefined,
      "42P01",
      42,
      [],
      ["42P01"],
    ]) {
      expect(failed(after)).toEqual({ kind: "migration_failed", code: null });
    }
  });

  it("never reads before, even when one is planted", () => {
    const details = failed({ code: "42P01" }, { error: MARKER, code: "08006" });
    expect(details).toEqual({ kind: "migration_failed", code: "42P01" });
    expect(JSON.stringify(details)).not.toContain(MARKER);
  });

  it("ignores an inherited code", () => {
    const after = Object.create({ code: "42P01" }) as object;
    expect(failed(after)).toEqual({ kind: "migration_failed", code: null });
  });
});

describe("platformAuditDetails: company.migration_recovered", () => {
  it("keeps a migration tag and nothing else", () => {
    const details = platformAuditDetails(
      "company.migration_recovered",
      { error: MARKER },
      {
        maintenanceMode: false,
        version: "0006_foreign_key_indexes",
        note: MARKER,
      },
    );
    expect(details).toEqual({ kind: "migration_recovered", version: "0006_foreign_key_indexes" });
    expect(JSON.stringify(details)).not.toContain(MARKER);
  });

  it("gives no version for anything that isn't a tag", () => {
    for (const after of [
      { version: "0006 marker text" },
      { version: `0006_${MARKER}` },
      { version: 42 },
      { version: `0006_${"a".repeat(81)}` },
      {},
      null,
      "0006_foreign_key_indexes",
    ]) {
      expect(platformAuditDetails("company.migration_recovered", null, after)).toEqual({
        kind: "migration_recovered",
        version: null,
      });
    }
  });
});

describe("platformAuditDetails: company.access_changed allow-list", () => {
  it("shows a real save's diff, with the written rows as counts and the limits as from and to", () => {
    const row = accessRow();
    expect(platformAuditDetails("company.access_changed", row.before, stored(row.after))).toEqual({
      kind: "access_changed",
      modulesSwitchedOn: ["wholesale"],
      modulesSwitchedOff: ["retail"],
      keysAdded: ["sales.quote.view"],
      keysRemoved: ["retail.sample.view"],
      userLimit: { from: 16, to: 10 },
      branchLimit: null,
      overrideRows: 2,
      limitRows: 1,
    });
  });

  it("shows a save that wrote rows only, with empty lists and no limits", () => {
    const after = { overrideRows: [{ module: "retail", action: "remove" }] };
    expect(platformAuditDetails("company.access_changed", {}, after)).toEqual({
      kind: "access_changed",
      modulesSwitchedOn: [],
      modulesSwitchedOff: [],
      keysAdded: [],
      keysRemoved: [],
      userLimit: null,
      branchLimit: null,
      overrideRows: 1,
      limitRows: 0,
    });
  });

  it("gives a limit with no before as from null, and a removed limit as to null", () => {
    expect(platformAuditDetails("company.access_changed", {}, { branchLimit: 4 })).toMatchObject({
      branchLimit: { from: null, to: 4 },
    });
    expect(platformAuditDetails("company.access_changed", { userLimit: 5 }, { userLimit: null })).toMatchObject({
      userLimit: { from: 5, to: null },
    });
  });

  it("still shows a retired key, because the lists check a pattern, not the catalog", () => {
    expect(platformAuditDetails("company.access_changed", {}, { keysRemoved: ["sales.payment.create"] })).toMatchObject(
      {
        kind: "access_changed",
        keysRemoved: ["sales.payment.create"],
      },
    );
  });

  it("accepts lists as long as the catalog, and override and limit lists of 50", () => {
    const keys = ALL_PERMISSION_KEYS.map((key) => key);
    const overrides = Array.from({ length: 50 }, () => ({ module: "retail", action: "remove" }));
    const limits = Array.from({ length: 50 }, () => ({
      subscriptionId: SUBSCRIPTION,
      userLimitOverride: null,
      branchLimitOverride: 0,
    }));
    const details = platformAuditDetails(
      "company.access_changed",
      {},
      {
        keysAdded: keys,
        overrideRows: overrides,
        limitRows: limits,
      },
    );
    expect(details).toMatchObject({ kind: "access_changed", overrideRows: 50, limitRows: 50 });
  });

  it("hides the whole entry when after breaks the allow-list in any way", () => {
    const breaks: ((after: Record<string, unknown>) => Record<string, unknown>)[] = [
      (after) => ({ ...after, secret: MARKER }),
      (after) => ({ ...after, keysAdded: ["sales quote view"] }),
      (after) => ({ ...after, keysAdded: [`sales.${MARKER}`] }),
      (after) => ({ ...after, keysAdded: ["a.b.c.d.e"] }),
      (after) => ({ ...after, keysAdded: [`a${"b".repeat(100)}`] }),
      (after) => ({ ...after, keysAdded: [42] }),
      (after) => ({ ...after, keysAdded: "sales.quote.view" }),
      (after) => ({ ...after, keysRemoved: [...ALL_PERMISSION_KEYS, "sales.quote.view"] }),
      (after) => ({ ...after, limitRows: [{ subscriptionId: "sub-1", userLimitOverride: 1, branchLimitOverride: 1 }] }),
      (after) => ({ ...after, limitRows: [{ subscriptionId: SUBSCRIPTION, userLimitOverride: 1 }] }),
      (after) => ({
        ...after,
        limitRows: [{ subscriptionId: SUBSCRIPTION, userLimitOverride: 1, branchLimitOverride: 1, note: MARKER }],
      }),
      (after) => ({ ...after, overrideRows: [{ module: "retail", action: "write" }] }),
      (after) => ({ ...after, overrideRows: [{ module: "retail", action: "write", enabled: "yes" }] }),
      (after) => ({ ...after, overrideRows: [{ module: "retail", action: "remove", enabled: true }] }),
      (after) => ({ ...after, overrideRows: [{ module: "retail", action: "delete" }] }),
      (after) => ({ ...after, overrideRows: [{ module: "Retail", action: "remove" }] }),
      (after) => ({
        ...after,
        overrideRows: Array.from({ length: 51 }, () => ({ module: "retail", action: "remove" })),
      }),
      (after) => ({ ...after, userLimit: 1.5 }),
      (after) => ({ ...after, userLimit: -1 }),
      (after) => ({ ...after, userLimit: 1_000_001 }),
      (after) => ({ ...after, branchLimit: "5" }),
    ];
    for (const change of breaks) {
      const details = accessWith(change);
      expect(details).toEqual(HIDDEN);
      expect(JSON.stringify(details)).not.toContain(MARKER);
    }
  });

  it("hides the entry when before breaks the allow-list", () => {
    const after = { userLimit: 10 };
    for (const before of [
      null,
      undefined,
      [],
      "16",
      { userLimit: 1.5 },
      { userLimit: 16, note: MARKER },
      { keysAdded: [] },
    ]) {
      expect(platformAuditDetails("company.access_changed", before, after)).toEqual(HIDDEN);
    }
  });

  it("hides an after that is not a plain object", () => {
    for (const after of [null, undefined, [], "text", 42, new Date()]) {
      expect(platformAuditDetails("company.access_changed", {}, after)).toEqual(HIDDEN);
    }
  });

  it("gives copies of the lists, so a caller can't change the stored row", () => {
    const after = { keysAdded: ["sales.quote.view"] };
    const details = platformAuditDetails("company.access_changed", {}, after);
    if (details.kind !== "access_changed") throw new Error("expected access details");
    details.keysAdded.push("retail.sample.view");
    expect(after.keysAdded).toEqual(["sales.quote.view"]);
  });
});

describe("platformAuditDetails: support requests and decisions", () => {
  const expiresAt = "2026-11-15T14:00:00.000Z";

  it("shows a request's reason and end", () => {
    for (const before of [null, undefined]) {
      expect(platformAuditDetails("support.requested", before, { reason: "Checking roles", expiresAt })).toEqual({
        kind: "support_requested",
        reason: "Checking roles",
        expiresAt,
      });
    }
  });

  it("gives the end as an ISO moment in UTC", () => {
    const details = platformAuditDetails("support.requested", null, {
      reason: "Checking roles",
      expiresAt: "2026-11-15T09:00:00.123456-05:00",
    });
    expect(details).toEqual({
      kind: "support_requested",
      reason: "Checking roles",
      expiresAt: "2026-11-15T14:00:00.123Z",
    });
  });

  it("hides a request that doesn't fit exactly", () => {
    const reason = "Checking roles";
    for (const [before, after] of [
      [null, { reason, expiresAt, note: MARKER }],
      [{ reason: MARKER }, { reason, expiresAt }],
      [{}, { reason, expiresAt }],
      [null, { reason: "x".repeat(501), expiresAt }],
      [null, { reason: "", expiresAt }],
      [null, { reason: 42, expiresAt }],
      [null, { reason, expiresAt: "next tuesday" }],
      [null, { reason, expiresAt: "1" }],
      [null, { reason, expiresAt: "2026-13-45T99:00:00Z" }],
      [null, { reason, expiresAt: Date.parse(expiresAt) }],
      [null, { reason }],
      [null, null],
      [null, [reason, expiresAt]],
    ] as [unknown, unknown][]) {
      const details = platformAuditDetails("support.requested", before, after);
      expect(details).toEqual(HIDDEN);
      expect(JSON.stringify(details)).not.toContain(MARKER);
    }
  });

  it("accepts a reason of up to 500 characters", () => {
    const reason = "r".repeat(500);
    expect(platformAuditDetails("support.requested", null, { reason, expiresAt })).toMatchObject({ reason });
  });

  it("shows an approval or a revocation only when it carries no before or after", () => {
    expect(platformAuditDetails("support.approved", null, null)).toEqual({
      kind: "support_decided",
      decision: "approved",
    });
    expect(platformAuditDetails("support.revoked", undefined, undefined)).toEqual({
      kind: "support_decided",
      decision: "revoked",
    });
    for (const [before, after] of [
      [null, {}],
      [null, { approvedBy: COMPANY_OWNER }],
      [{}, null],
      [null, MARKER],
    ] as [unknown, unknown][]) {
      expect(platformAuditDetails("support.approved", before, after)).toEqual(HIDDEN);
      expect(platformAuditDetails("support.revoked", before, after)).toEqual(HIDDEN);
    }
  });
});

describe("platformAuditDetails: unknown actions", () => {
  it("hides any action this build doesn't know", () => {
    for (const action of ["company.secret_dump", "company.deleted", "", "toString", "__proto__", "constructor"]) {
      const details = platformAuditDetails(action, { [MARKER]: MARKER }, { [MARKER]: MARKER });
      expect(details).toEqual(HIDDEN);
    }
  });
});

describe("the six actions and their actors", () => {
  it("lists six actions from the one record, in its order", () => {
    expect(PLATFORM_AUDIT_ACTIONS).toEqual([
      "company.access_changed",
      "support.requested",
      "support.approved",
      "support.revoked",
      "company.migration_failed",
      "company.migration_recovered",
    ]);
    expect(PLATFORM_AUDIT_ACTIONS).toEqual(Object.keys(PLATFORM_AUDIT_ACTOR));
  });

  it("names the two platform-admin actions", () => {
    expect(PLATFORM_ADMIN_AUDIT_ACTIONS).toEqual(["company.access_changed", "support.requested"]);
  });

  it("takes the actor kind from the action", () => {
    expect(platformAuditActorKind("company.access_changed")).toBe("platform_admin");
    expect(platformAuditActorKind("support.approved")).toBe("company_user");
    expect(platformAuditActorKind("support.revoked")).toBe("company_user");
    expect(platformAuditActorKind("company.migration_failed")).toBe("system");
    expect(platformAuditActorKind("company.migration_recovered")).toBe("system");
    for (const action of ["company.secret_dump", "toString", "__proto__", 42, null]) {
      expect(platformAuditActorKind(action)).toBe("unknown");
    }
  });

  it("knows only the six actions, not inherited names", () => {
    for (const action of PLATFORM_AUDIT_ACTIONS) expect(isPlatformAuditAction(action)).toBe(true);
    for (const action of ["toString", "__proto__", "constructor", "company.deleted", "", "SUPPORT.REQUESTED"]) {
      expect(isPlatformAuditAction(action)).toBe(false);
    }
  });
});

describe("platformAuditActor (platform-admin spec, PlatformAuditActor)", () => {
  it("names a platform admin, or Former admin when the user row is gone", () => {
    expect(platformAuditActor("support.requested", ADMIN_OWNER, "Dana Whitfield")).toEqual({
      kind: "platform_admin",
      userId: ADMIN_OWNER,
      name: "Dana Whitfield",
    });
    expect(platformAuditActor("company.access_changed", ADMIN_OWNER, null)).toEqual({
      kind: "platform_admin",
      userId: ADMIN_OWNER,
      name: FORMER_ADMIN_NAME,
    });
    expect(FORMER_ADMIN_NAME).toBe("Former admin");
  });

  it("gives unknown for a platform-admin action with no actor", () => {
    expect(platformAuditActor("company.access_changed", null, "Dana Whitfield")).toEqual({ kind: "unknown" });
    expect(platformAuditActor("company.access_changed", "", null)).toEqual({ kind: "unknown" });
  });

  it("never identifies the company's Owner or names the migration runner, even when given an id", () => {
    expect(platformAuditActor("support.approved", COMPANY_OWNER, "Owner Name")).toEqual({ kind: "company_user" });
    expect(platformAuditActor("support.revoked", COMPANY_OWNER, "Owner Name")).toEqual({ kind: "company_user" });
    expect(platformAuditActor("company.migration_failed", COMPANY_OWNER, "x")).toEqual({ kind: "system" });
    expect(platformAuditActor("company.secret_dump", ADMIN_OWNER, "Dana")).toEqual({ kind: "unknown" });
  });
});

describe("migrationErrorCode, the version tag and the field patterns", () => {
  it("keeps only error codes", () => {
    expect(MIGRATION_ERROR_CODE.source).toBe("^[A-Z0-9_]{1,32}$");
    for (const code of ["42P01", "28P01", "08006", "ECONNREFUSED", "ERR_SOCKET_TIMEOUT", "A".repeat(32)]) {
      expect(migrationErrorCode(code)).toBe(code);
    }
    for (const value of ["42p01", "42P01 ", "42P01\n", "", "A".repeat(33), 42, null, undefined, { code: "42P01" }]) {
      expect(migrationErrorCode(value)).toBeNull();
    }
  });

  it("matches the journal's migration tags", () => {
    expect(MIGRATION_VERSION.test("0006_foreign_key_indexes")).toBe(true);
    expect(MIGRATION_VERSION.test("0000_init")).toBe(true);
    expect(MIGRATION_VERSION.test("006_short")).toBe(false);
    expect(MIGRATION_VERSION.test("0006_Upper")).toBe(false);
  });

  it("keeps a target id only when it is a UUID of any version", () => {
    expect(auditTargetId(GRANT)).toBe(GRANT);
    expect(auditTargetId(GRANT.toUpperCase())).toBe(GRANT.toUpperCase());
    expect(auditTargetId("6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
    for (const value of ["summit", `${GRANT} `, `${GRANT}x`, "", null, undefined, 42]) {
      expect(auditTargetId(value)).toBeNull();
    }
  });

  it("keeps a target type only when it fits, else unknown", () => {
    expect(auditTargetType("support_access_grant")).toBe("support_access_grant");
    expect(auditTargetType("tenant")).toBe("tenant");
    for (const value of [`tenant; ${MARKER}`, "Tenant", "a".repeat(65), "", "tenant_database1", null, 42]) {
      expect(auditTargetType(value)).toBe("unknown");
    }
  });

  it("keeps an action name only when it fits object.verb, else unknown", () => {
    expect(auditActionName("company.access_changed")).toBe("company.access_changed");
    expect(auditActionName("company.secret_dump")).toBe("company.secret_dump");
    for (const value of ["company", "company.access.changed", `company.${MARKER}`, "Company.x", "a.", ".b", null]) {
      expect(auditActionName(value)).toBe("unknown");
    }
    expect(auditActionName(`${"a".repeat(41)}.b`)).toBe("unknown");
  });

  it("bounds a page and words the query refusals as the spec does", () => {
    expect(PLATFORM_AUDIT_PAGE).toEqual({ min: 1, max: 100, default: 50 });
    expect(PLATFORM_AUDIT_QUERY_MESSAGES).toEqual({
      action: "Choose an action from the list.",
      before: "That page of the audit log does not exist. Start from the newest entries.",
      limit: "Ask for 1 to 100 entries at a time.",
    });
  });
});

describe("platformAuditView (platform-admin spec, PlatformAuditView; ADR 0053)", () => {
  const owner = { role: "owner" as const, userId: ADMIN_OWNER };
  const support = { role: "support" as const, userId: ADMIN_SUPPORT };
  const at = new Date("2026-11-15T10:00:00.123Z");

  function row(overrides: Partial<PlatformAuditRow>): PlatformAuditRow {
    return {
      id: GRANT,
      at,
      action: "support.requested",
      tenantId: COMPANY,
      companyName: "Summit Floor Co.",
      actorUserId: ADMIN_OWNER,
      actorName: "Dana Whitfield",
      targetType: "support_access_grant",
      targetId: GRANT,
      before: null,
      after: { reason: "Checking the roles the Owner asked about", expiresAt: "2026-11-15T12:00:00.000Z" },
      ip: "203.0.113.9",
      userAgent: "Test agent",
      ...overrides,
    };
  }

  it("maps an admin's entry with its company, actor, target and network for the owner role", () => {
    expect(platformAuditView(row({}), owner)).toEqual({
      id: GRANT,
      at: "2026-11-15T10:00:00.123Z",
      action: "support.requested",
      company: { id: COMPANY, name: "Summit Floor Co." },
      actor: { kind: "platform_admin", userId: ADMIN_OWNER, name: "Dana Whitfield" },
      targetType: "support_access_grant",
      targetId: GRANT,
      details: {
        kind: "support_requested",
        reason: "Checking the roles the Owner asked about",
        expiresAt: "2026-11-15T12:00:00.000Z",
      },
      network: { ip: "203.0.113.9", userAgent: "Test agent" },
    });
  });

  it("hides another admin's support reason from the support role and leaves out the network key", () => {
    const view = platformAuditView(row({}), support);
    expect(view.details).toEqual(HIDDEN);
    expect(view.actor).toEqual({ kind: "platform_admin", userId: ADMIN_OWNER, name: "Dana Whitfield" });
    expect(view.company).toEqual({ id: COMPANY, name: "Summit Floor Co." });
    expect("network" in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain("Checking the roles");
    expect(JSON.stringify(view)).not.toContain("203.0.113.9");
  });

  it("shows the support role its own support reason", () => {
    const view = platformAuditView(row({ actorUserId: ADMIN_SUPPORT }), support);
    expect(view.details).toMatchObject({ kind: "support_requested" });
  });

  it("hides a support reason from the support role when the request has no actor", () => {
    expect(platformAuditView(row({ actorUserId: null }), support).details).toEqual(HIDDEN);
  });

  it("gives no network on a company Owner's or the runner's entry, even for the owner role", () => {
    const approval = platformAuditView(
      row({ action: "support.approved", actorUserId: COMPANY_OWNER, actorName: "Owner Name", after: null }),
      owner,
    );
    expect(approval.actor).toEqual({ kind: "company_user" });
    expect(approval.details).toEqual({ kind: "support_decided", decision: "approved" });
    expect("network" in approval).toBe(false);
    for (const text of [COMPANY_OWNER, "Owner Name", "203.0.113.9"])
      expect(JSON.stringify(approval)).not.toContain(text);

    const migration = platformAuditView(
      row({
        action: "company.migration_failed",
        actorUserId: null,
        actorName: null,
        targetType: "tenant_database",
        after: { maintenanceMode: true, error: MARKER },
      }),
      owner,
    );
    expect(migration.actor).toEqual({ kind: "system" });
    expect(migration.details).toEqual({ kind: "migration_failed", code: null });
    expect("network" in migration).toBe(false);
    expect(JSON.stringify(migration)).not.toContain(MARKER);
  });

  it("shows an unknown action as unknown and hidden, with its junk fields refused", () => {
    const view = platformAuditView(
      row({
        action: "company.secret_dump",
        targetType: `tenant; ${MARKER}`,
        targetId: MARKER,
        before: { [MARKER]: MARKER },
        after: { [MARKER]: MARKER },
      }),
      owner,
    );
    expect(view).toMatchObject({
      action: "company.secret_dump",
      actor: { kind: "unknown" },
      targetType: "unknown",
      targetId: null,
      details: HIDDEN,
    });
    expect("network" in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain(MARKER);
  });

  it("gives no company when the entry has none or the company row is gone", () => {
    expect(platformAuditView(row({ tenantId: null }), owner).company).toBeNull();
    expect(platformAuditView(row({ companyName: null }), owner).company).toBeNull();
  });

  it("keeps a string moment as given and names a removed admin Former admin", () => {
    const view = platformAuditView(row({ at: "2026-11-15T10:00:00.123456+00:00", actorName: null }), owner);
    expect(view.at).toBe("2026-11-15T10:00:00.123456+00:00");
    expect(view.actor).toEqual({ kind: "platform_admin", userId: ADMIN_OWNER, name: FORMER_ADMIN_NAME });
  });
});
