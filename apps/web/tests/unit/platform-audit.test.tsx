import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  SUPPORT_LIMIT_MESSAGE,
  SUPPORT_OPEN_MESSAGE,
  type PermissionKey,
  type PlatformAuditDetails,
  type PlatformAuditResult,
  type PlatformAuditView,
  type PlatformDatabaseStatus,
} from "@workspace/shared";
import { ceilingLock } from "@/features/admin/access-draft";
import { auditColumns } from "@/features/admin/audit-columns";
import { auditActionLabel, auditActorText, auditDetailsText, type AuditFormat } from "@/features/admin/audit-labels";
import { appendOlderAuditPage, auditRows, olderAuditCursor, runOlderAuditLoad } from "@/features/admin/audit-paging";
import { databaseErrorText, databaseText } from "@/features/admin/database-labels";
import { PlatformRoleProvider, usePlatformRole } from "@/features/admin/platform-role";
import type { ApiClient } from "@/lib/api/contract";
import { DemoRuleError } from "@/lib/api/demo/admin-rules";
import { demoAuditPage, type DemoPlatformAuditRow } from "@/lib/api/demo/platform-audit";
import { demoGrantViews, demoRequestRefusal, type DemoSupportGrant } from "@/lib/api/demo/platform-support";
import { API_METHODS } from "@/lib/api/http/api-methods";
import { routeClient } from "@/lib/api/http/router";
import { HttpTransport } from "@/lib/api/http/transport";

const COMPANY_ID = "0195f3a2-7b1c-7d4e-8f00-1234567890ab";
const ENTRY_ID = "0195f3a2-7b1c-7d4e-8f00-0000000000aa";
const HOUR = 3_600_000;

interface Sent {
  url: string;
  method: string;
  body: unknown;
}

/** A client whose platform methods go over a fake fetch that records each request. */
function httpClient(answer: unknown) {
  const sent: Sent[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    sent.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(answer), { status: 200 });
  }) as unknown as typeof fetch;
  const client = routeClient({} as ApiClient, new HttpTransport("http://api.test", fetcher), API_METHODS);
  return { client, sent };
}

/** A demo audit row, newest last by default. */
function row(id: string, at: string, overrides: Partial<DemoPlatformAuditRow> = {}): DemoPlatformAuditRow {
  return {
    id,
    at,
    tenantId: "summit",
    companyName: "Summit Floor Co.",
    action: "support.requested",
    targetType: "support_access_grant",
    targetId: null,
    before: null,
    after: { reason: `Checking roles for ${id}`, expiresAt: "2026-11-16T09:00:00.000Z" },
    ...overrides,
  };
}

/** A demo grant asked for at `createdAt`, lasting `hours`. */
function grant(
  id: string,
  createdAt: Date,
  hours: number,
  overrides: Partial<DemoSupportGrant> = {},
): DemoSupportGrant {
  return {
    id,
    companyId: "summit",
    companyName: "Summit Floor Co.",
    reason: "Checking the roles the Owner asked about",
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + hours * HOUR).toISOString(),
    approvedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

const FORMAT: AuditFormat & { dateTime: (iso: string) => string } = {
  count: (value) => `#${value}`,
  date: (iso) => `on ${iso.slice(0, 10)}`,
  dateTime: (iso) => iso,
};

describe("platform audit and support over HTTP", () => {
  it("sends only the audit filters that are set, in order", async () => {
    const { client, sent } = httpClient({ entries: [], nextCursor: null });
    await client.listPlatformAudit({});
    await client.listPlatformAudit({ action: "support.requested" });
    await client.listPlatformAudit({
      companyId: COMPANY_ID,
      action: "company.access_changed",
      before: ENTRY_ID,
      limit: 20,
    });
    expect(sent.map((s) => s.url)).toEqual([
      "http://api.test/platform/audit",
      "http://api.test/platform/audit?action=support.requested",
      `http://api.test/platform/audit?companyId=${COMPANY_ID}&action=company.access_changed&before=${ENTRY_ID}&limit=20`,
    ]);
  });

  it("never sends a company or a cursor that is not a UUID, and reads an empty page", async () => {
    const { client, sent } = httpClient({ entries: [{ id: "x" }], nextCursor: "y" });
    expect(await client.listPlatformAudit({ companyId: "summit" })).toEqual({ entries: [], nextCursor: null });
    expect(await client.listPlatformAudit({ before: "summit-pal-1" })).toEqual({ entries: [], nextCursor: null });
    expect(sent).toEqual([]);
  });

  it("lists a company's support requests by UUID only", async () => {
    const { client, sent } = httpClient([]);
    expect(await client.listPlatformSupportGrants("summit")).toEqual([]);
    expect(sent).toEqual([]);
    await client.listPlatformSupportGrants(COMPANY_ID);
    expect(sent).toEqual([
      { url: `http://api.test/platform/support-grants?companyId=${COMPANY_ID}`, method: "GET", body: undefined },
    ]);
  });

  it("sends a support request with only its three fields", async () => {
    const { client, sent } = httpClient({ id: ENTRY_ID });
    const input = { companyId: COMPANY_ID, reason: "Checking the roles", hours: 2, role: "owner", tenantId: "x" };
    expect(await client.requestSupportAccess(input)).toEqual({ id: ENTRY_ID });
    expect(sent).toEqual([
      {
        url: "http://api.test/platform/support-grants",
        method: "POST",
        body: { companyId: COMPANY_ID, reason: "Checking the roles", hours: 2 },
      },
    ]);
  });
});

describe("demo platform audit log", () => {
  const rows = [
    row("a", "2026-11-15T09:00:00.000Z"),
    row("b", "2026-11-15T10:00:00.000Z", { tenantId: "keystone", companyName: "Keystone" }),
    row("c", "2026-11-15T11:00:00.000Z", {
      action: "company.access_changed",
      before: {},
      after: { keysRemoved: ["retail.sample.view"] },
    }),
    row("d", "2026-11-15T11:00:00.000Z"),
  ];

  it("pages through the rows newest first, the cursor naming the last entry", () => {
    const first = demoAuditPage(rows, { limit: 2 });
    expect(first.entries.map((e) => e.id)).toEqual(["d", "c"]);
    expect(first.nextCursor).toBe("c");
    const second = demoAuditPage(rows, { limit: 2, before: "c" });
    expect(second.entries.map((e) => e.id)).toEqual(["b", "a"]);
    expect(second.nextCursor).toBeNull();
    expect(demoAuditPage(rows, {}).entries).toHaveLength(4);
  });

  it("filters by company and action, a cursor working with any filter", () => {
    expect(demoAuditPage(rows, { companyId: "keystone" }).entries.map((e) => e.id)).toEqual(["b"]);
    expect(demoAuditPage(rows, { action: "company.access_changed" }).entries.map((e) => e.id)).toEqual(["c"]);
    expect(demoAuditPage(rows, { companyId: "summit", before: "b" }).entries.map((e) => e.id)).toEqual(["a"]);
  });

  it("refuses an unknown cursor and a page size outside 1 to 100, with the API's messages", () => {
    expect(() => demoAuditPage(rows, { before: "nope" })).toThrow(DemoRuleError);
    expect(() => demoAuditPage(rows, { before: "nope" })).toThrow(
      "That page of the audit log does not exist. Start from the newest entries.",
    );
    expect(() => demoAuditPage(rows, { limit: 0 })).toThrow("Ask for 1 to 100 entries at a time.");
    expect(() => demoAuditPage(rows, { limit: 101 })).toThrow("Ask for 1 to 100 entries at a time.");
  });

  it("shows a stored migration failure as its code only, never its text", () => {
    const stored = [
      row("m", "2026-11-15T12:00:00.000Z", {
        action: "company.migration_failed",
        after: { maintenanceMode: true, error: "duplicate key Key (email)=(marker@example.com)" },
        before: { error: "marker" },
      }),
    ];
    const page = demoAuditPage(stored, {});
    expect(page.entries[0]?.details).toEqual({ kind: "migration_failed", code: null });
    expect(JSON.stringify(page)).not.toContain("marker");
  });

  it("drops a hand-edited row that doesn't fit and hides details outside the allow-list", () => {
    const stored = [
      { id: 1, at: "not a date" },
      "text",
      row("x", "2026-11-15T12:00:00.000Z", {
        after: { reason: "fits", expiresAt: "2026-11-16T09:00:00.000Z", extra: 1 },
      }),
    ];
    const page = demoAuditPage(stored, {});
    expect(page.entries.map((e) => e.id)).toEqual(["x"]);
    expect(page.entries[0]?.details).toEqual({ kind: "hidden" });
  });

  it("names the demo admin, and records no address or device", () => {
    const [entry] = demoAuditPage(rows, { limit: 1 }).entries;
    expect(entry?.actor).toEqual({ kind: "platform_admin", userId: "platform", name: "Platform admin" });
    expect(entry?.network).toEqual({ ip: null, userAgent: null });
    expect(entry?.company).toEqual({ id: "summit", name: "Summit Floor Co." });
  });
});

describe("older audit pages on the screen", () => {
  // Six entries, "a" oldest and "f" newest, read two at a time: f e | d c | b a.
  const stored = ["a", "b", "c", "d", "e", "f"].map((id, i) => row(id, `2026-11-15T0${i}:00:00.000Z`));
  const page = (before?: string) => demoAuditPage(stored, before === undefined ? { limit: 2 } : { limit: 2, before });
  const ids = (entries: readonly PlatformAuditView[]) => entries.map((entry) => entry.id);

  it("adds a page that two loads asked for with one cursor only once", () => {
    const first = page();
    const once = appendOlderAuditPage(first, null, "e", page("e"));
    // The toast's Try again answers for the same cursor after the button's load already did.
    const twice = appendOlderAuditPage(first, once, "e", page("e"));
    expect(twice).toBe(once);
    expect(ids(auditRows(first, twice))).toEqual(["f", "e", "d", "c"]);
    expect(olderAuditCursor(first, twice)).toBe("c");
  });

  it("drops a late answer for a page already passed, so paging to the end shows each entry once", () => {
    const first = page();
    let older = appendOlderAuditPage(first, null, "e", page("e"));
    older = appendOlderAuditPage(first, older, "c", page("c"));
    expect(olderAuditCursor(first, older)).toBeNull();
    const afterRetry = appendOlderAuditPage(first, older, "e", page("e"));
    expect(afterRetry).toBe(older);
    expect(ids(auditRows(first, afterRetry))).toEqual(["f", "e", "d", "c", "b", "a"]);
    expect(olderAuditCursor(first, afterRetry)).toBeNull();
  });

  it("shows an entry that comes back on a later page once", () => {
    const first = page();
    const overlapping = { entries: [...first.entries, ...page("e").entries], nextCursor: "c" };
    const older = appendOlderAuditPage(first, null, "e", overlapping);
    expect(ids(auditRows(first, older))).toEqual(["f", "e", "d", "c"]);
    expect(new Set(ids(auditRows(first, older))).size).toBe(4);
  });

  it("starts again below the newest page when a re-read moves its cursor, leaving no gap", () => {
    const first = page();
    const older = appendOlderAuditPage(first, null, "e", page("e"));
    const grown = [...stored, row("g", "2026-11-15T07:00:00.000Z")];
    const reread = demoAuditPage(grown, { limit: 2 });
    expect(ids(auditRows(reread, older))).toEqual(["g", "f"]);
    expect(olderAuditCursor(reread, older)).toBe("f");
    expect(appendOlderAuditPage(reread, older, "e", page("e"))).toBe(older);
    const next = appendOlderAuditPage(reread, older, "f", demoAuditPage(grown, { limit: 2, before: "f" }));
    expect(ids(auditRows(reread, next))).toEqual(["g", "f", "e", "d"]);
    expect(olderAuditCursor(reread, next)).toBe("d");
  });

  /** One load whose answer the test settles by hand, and what it did on the screen. */
  function pendingLoad() {
    let live = true;
    let settle: { resolve: (page: PlatformAuditResult) => void; reject: (failure: Error) => void } | null = null;
    const added: PlatformAuditResult[] = [];
    const toasts: string[] = [];
    const run = runOlderAuditLoad({
      read: () =>
        new Promise((resolve, reject) => {
          settle = { resolve, reject };
        }),
      live: () => live,
      add: (older) => added.push(older),
      fail: (message) => toasts.push(message),
    });
    const leave = () => {
      live = false;
    };
    return { run, added, toasts, leave, answer: () => settle! };
  }

  it("shows a failure toast, or adds the page, while the entries are still on screen", async () => {
    const failing = pendingLoad();
    failing.answer().reject(new Error("The API did not answer."));
    await failing.run;
    expect(failing.toasts).toEqual(["The API did not answer."]);
    const loading = pendingLoad();
    loading.answer().resolve(page("e"));
    await loading.run;
    expect(ids(loading.added[0]!.entries)).toEqual(["d", "c"]);
    expect(loading.toasts).toEqual([]);
  });

  it("shows no toast and adds nothing when the answer comes after new filters or leaving the page", async () => {
    const failing = pendingLoad();
    failing.leave();
    failing.answer().reject(new Error("The API did not answer."));
    await failing.run;
    expect(failing.toasts).toEqual([]);
    expect(failing.added).toEqual([]);
    const loading = pendingLoad();
    loading.leave();
    loading.answer().resolve(page("e"));
    await loading.run;
    expect(loading.added).toEqual([]);
    expect(loading.toasts).toEqual([]);
  });
});

describe("demo support requests", () => {
  const now = new Date("2026-11-15T12:00:00.000Z");

  it("derives each status with the shared rule, newest first, for one company", () => {
    const grants = [
      grant("old", new Date(now.getTime() - 5 * HOUR), 2),
      grant("open", new Date(now.getTime() - HOUR), 4),
      grant("gone", new Date(now.getTime() - 2 * HOUR), 4, { revokedAt: now.toISOString() }),
      grant("yes", new Date(now.getTime() - 3 * HOUR), 8, { approvedAt: now.toISOString() }),
      grant("other", new Date(now.getTime() - HOUR), 4, { companyId: "keystone" }),
    ];
    const views = demoGrantViews(grants, "summit", now);
    expect(views.map((v) => [v.id, v.status])).toEqual([
      ["open", "pending"],
      ["gone", "revoked"],
      ["yes", "approved"],
      ["old", "expired"],
    ]);
    expect(views[0]).toMatchObject({ mine: true, admin: { name: "Platform admin" }, company: { id: "summit" } });
  });

  it("refuses an open request for the company first, then the 24-hour limit", () => {
    expect(demoRequestRefusal([grant("open", now, 4)], "summit", now)).toMatchObject({
      status: 409,
      message: SUPPORT_OPEN_MESSAGE,
    });
    const closed = Array.from({ length: 10 }, (_, i) =>
      grant(`g${i}`, new Date(now.getTime() - (i + 1) * 60_000), 1, { revokedAt: now.toISOString() }),
    );
    expect(demoRequestRefusal(closed, "summit", now)).toMatchObject({ status: 429, message: SUPPORT_LIMIT_MESSAGE });
    expect(demoRequestRefusal(closed.slice(1), "summit", now)).toBeNull();
    expect(demoRequestRefusal([grant("open", now, 4)], "keystone", now)).toBeNull();
  });
});

describe("console labels", () => {
  const database = (overrides: Partial<PlatformDatabaseStatus>): PlatformDatabaseStatus => ({
    status: "ready",
    schemaVersion: "0007",
    hasError: false,
    errorCode: null,
    ...overrides,
  });

  it("says where a database stands with its error code, never more", () => {
    expect(databaseText(database({ status: null, schemaVersion: null }))).toBe("No database");
    expect(databaseText(database({}))).toBe("Ready");
    expect(databaseText(database({ status: "failed", hasError: true, errorCode: "42P01" }))).toBe(
      "Update failed, error 42P01",
    );
    expect(databaseText(database({ status: "read_only", hasError: true }))).toBe("Read-only, no error code recorded");
    expect(databaseErrorText(database({ hasError: true, errorCode: "42P01" }))).toBe("Error code 42P01");
    expect(databaseErrorText(database({ hasError: true, errorCode: "duplicate key (email)" }))).toBe(
      "No error code recorded",
    );
    expect(databaseErrorText(database({ errorCode: "42P01" }))).toBeNull();
  });

  it("names who made an entry without naming company people", () => {
    expect(auditActorText({ kind: "platform_admin", userId: "u", name: "Dana Whitfield" })).toBe("Dana Whitfield");
    expect(auditActorText({ kind: "company_user" })).toBe("The company's Owner");
    expect(auditActorText({ kind: "system" })).toBe("System (database update)");
    expect(auditActorText({ kind: "unknown" })).toBe("Unknown");
    expect(auditActionLabel("support.requested")).toBe("Asked for support access");
    expect(auditActionLabel("billing.charged")).toBe("billing.charged");
  });

  it("writes each kind of details from what they hold", () => {
    const text = (details: PlatformAuditDetails) => auditDetailsText(details, FORMAT);
    expect(
      text({
        kind: "access_changed",
        modulesSwitchedOn: ["hr"],
        modulesSwitchedOff: ["retired_module"],
        keysAdded: [],
        keysRemoved: ["retail.sample.view", "retired.key"],
        userLimit: { from: 16, to: 20 },
        branchLimit: { from: null, to: 3 },
        overrideRows: 1,
        limitRows: 2,
      }),
    ).toBe(
      "Switched on: HR; Switched off: retired_module; Removed: View sample checkout, retired.key; User limit: #16 → #20; Branch limit: No limit → #3; #1 override row, #2 limit rows written",
    );
    expect(
      text({
        kind: "access_changed",
        modulesSwitchedOn: [],
        modulesSwitchedOff: [],
        keysAdded: ["retail.sample.view"],
        keysRemoved: [],
        userLimit: null,
        branchLimit: null,
        overrideRows: 0,
        limitRows: 0,
      }),
    ).toBe("Added: View sample checkout");
    expect(text({ kind: "support_requested", reason: "Roles", expiresAt: "2026-11-16T09:00:00.000Z" })).toBe(
      "“Roles”; Ends on 2026-11-16",
    );
    expect(text({ kind: "support_decided", decision: "revoked" })).toBe("Revoked");
    expect(text({ kind: "migration_failed", code: "42P01" })).toBe("Error code 42P01");
    expect(text({ kind: "migration_failed", code: null })).toBe("No error code recorded");
    expect(text({ kind: "migration_recovered", version: "0006_foreign_key_indexes" })).toBe(
      "Now on schema 0006_foreign_key_indexes",
    );
    expect(text({ kind: "hidden" })).toBe("Details hidden");
  });

  it("offers the address and device column to the owner role only", () => {
    expect(auditColumns("support", FORMAT).map((c) => c.id)).toEqual(["at", "who", "company", "what", "details"]);
    expect(auditColumns("owner", FORMAT).map((c) => c.header)).toContain("Address and device");
    const entry: PlatformAuditView = {
      id: ENTRY_ID,
      at: "2026-11-15T09:00:00.000Z",
      action: "support.requested",
      company: null,
      actor: { kind: "platform_admin", userId: "u", name: "Dana Whitfield" },
      targetType: "support_access_grant",
      targetId: null,
      details: { kind: "hidden" },
    };
    const network = auditColumns("owner", FORMAT).find((c) => c.id === "network");
    expect(network?.value(entry)).toBe("Not recorded");
    expect(network?.value({ ...entry, network: { ip: "203.0.113.9", userAgent: "Browser/1.0" } })).toBe(
      "203.0.113.9 Browser/1.0",
    );
  });
});

describe("access page locks and role", () => {
  const key = "settings.users.manage" as PermissionKey;

  it("locks every box for a read-only role and only ticked protected keys otherwise", () => {
    expect(ceilingLock("retail.sample.view" as PermissionKey, [], true)).toBe("read_only");
    expect(ceilingLock(key, [key], false)).toBe("protected");
    // An unticked protected key stays tickable, so a company that lacks one is never trapped.
    expect(ceilingLock(key, [], false)).toBeNull();
    expect(
      ceilingLock("retail.sample.view" as PermissionKey, ["retail.sample.view" as PermissionKey], false),
    ).toBeNull();
  });

  it("reads the least privilege without a provider and the given role inside one", () => {
    const Probe = () => <span>{usePlatformRole()}</span>;
    expect(renderToStaticMarkup(<Probe />)).toBe("<span>support</span>");
    const inside = (
      <PlatformRoleProvider role="owner">
        <Probe />
      </PlatformRoleProvider>
    );
    expect(renderToStaticMarkup(inside)).toBe("<span>owner</span>");
  });
});
