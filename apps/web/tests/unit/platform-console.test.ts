import { describe, expect, it } from "vitest";
import {
  ACCESS_NO_PLAN_MESSAGE,
  accessPatchProblem,
  offeredKeys,
  offeredModules,
  PROTECTED_CEILING_KEYS,
  type Company,
  type PermissionKey,
  type PlatformAccessPatch,
  type PlatformCompany,
} from "@workspace/shared";
import { accessChanges, draftOf, hasPlan, limitProblem, saveProblem } from "@/features/admin/access-draft";
import type { ApiClient } from "@/lib/api/contract";
import { demoDetail, demoSubscription, demoSummary, withAccess } from "@/lib/api/demo/platform-console";
import { API_METHODS } from "@/lib/api/http/api-methods";
import { routeClient } from "@/lib/api/http/router";
import { HttpApiError, HttpTransport } from "@/lib/api/http/transport";
import { platformGateOf } from "@/lib/session/platform-gate";

const COMPANY_ID = "0195f3a2-7b1c-7d4e-8f00-1234567890ab";

interface Sent {
  url: string;
  method: string;
  body: unknown;
}

/** A client whose platform methods go over a fake fetch that records each request. */
function httpClient(status: number, answer: unknown) {
  const sent: Sent[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    sent.push({
      url,
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return new Response(JSON.stringify(answer), { status });
  }) as unknown as typeof fetch;
  const client = routeClient({} as ApiClient, new HttpTransport("http://api.test", fetcher), API_METHODS);
  return { client, sent };
}

/** A flooring company as GET /platform/companies/:id answers, with one plan row. */
function company(overrides: Partial<PlatformCompany> = {}): PlatformCompany {
  const keys = offeredKeys(["flooring"]);
  return {
    id: COMPANY_ID,
    slug: "summit",
    name: "Summit Floor Co.",
    city: "Denver",
    state: "CO",
    products: ["flooring"],
    status: "active",
    statusChangedAt: "2026-11-01T00:00:00.000Z",
    phase: "full",
    maintenance: { on: false, reason: null },
    plan: "Flooring Pro",
    modules: ["platform", "core", "retail", "installation", "contracts", "hr", "meetings"],
    userLimit: 16,
    branchLimit: 3,
    members: 9,
    database: { status: "ready", schemaVersion: "0007", hasError: false, errorCode: null },
    legalName: "Summit Floor Co. LLC",
    timeZone: "America/Denver",
    region: "us",
    createdAt: "2025-07-01T00:00:00.000Z",
    // Every offered key plus a key of the hidden Installation module, as a stored ceiling can hold.
    ceiling: [...keys, "installation.job.view" as PermissionKey],
    subscriptions: [
      {
        id: "0195f3a2-7b1c-7d4e-8f00-000000000001",
        planKey: "flooring-pro",
        planName: "Flooring Pro",
        product: "flooring",
        interval: "monthly",
        price: "0.00",
        currentPeriodStart: "2026-11-01T00:00:00.000Z",
        currentPeriodEnd: "2026-12-01T00:00:00.000Z",
        status: "active",
        userLimitOverride: null,
        branchLimitOverride: null,
      },
    ],
    ...overrides,
  };
}

/** A demo fixture company, as DemoStore keeps it. */
function demoCompany(): Company {
  const detail = company();
  return {
    id: "summit",
    name: detail.name,
    city: detail.city,
    state: detail.state,
    product: "flooring",
    modules: detail.modules,
    plan: "Flooring Pro",
    status: "active",
    userLimit: 16,
    branchLimit: 3,
    ceiling: detail.ceiling,
    branches: [],
    createdAt: "2025-07-01",
  };
}

describe("platform console over HTTP", () => {
  it("lists companies from GET /platform/companies", async () => {
    const { client, sent } = httpClient(200, []);
    await client.listPlatformCompanies();
    expect(sent).toEqual([{ url: "http://api.test/platform/companies", method: "GET", body: undefined }]);
  });

  it("never sends an id that is not a UUID, and reads a missing company as none", async () => {
    const bad = httpClient(200, {});
    expect(await bad.client.getPlatformCompany("summit")).toBeNull();
    expect(bad.sent).toEqual([]);

    const missing = httpClient(404, { code: "not_found", message: "That company does not exist." });
    expect(await missing.client.getPlatformCompany(COMPANY_ID)).toBeNull();
    expect(missing.sent[0]?.url).toBe(`http://api.test/platform/companies/${COMPANY_ID}`);
  });

  it("keeps a refusal as an error rather than a missing company", async () => {
    const { client } = httpClient(403, { code: "forbidden", message: "Only platform admins can use this." });
    await expect(client.getPlatformCompany(COMPANY_ID)).rejects.toBeInstanceOf(HttpApiError);
  });

  it("sends only the four access fields, and only those set", async () => {
    const { client, sent } = httpClient(200, company());
    const patch = { ceiling: ["settings.users.view"], userLimit: 12, companyId: "other", role: "owner" };
    await client.updatePlatformCompanyAccess(COMPANY_ID, patch as unknown as PlatformAccessPatch);
    expect(sent).toEqual([
      {
        url: `http://api.test/platform/companies/${COMPANY_ID}/access`,
        method: "PATCH",
        body: { ceiling: ["settings.users.view"], userLimit: 12 },
      },
    ]);
  });

  it("reads the restricted directory and escapes the id in the path", async () => {
    const { client, sent } = httpClient(200, { roles: [], users: [], branding: null, restricted: true });
    await client.getPlatformDirectory("a/b");
    expect(sent[0]?.url).toBe("http://api.test/platform/companies/a%2Fb/directory");
  });
});

describe("access draft", () => {
  it("starts from the offered, visible modules and keys only", () => {
    const draft = draftOf(company());
    expect(draft.modules).not.toContain("installation");
    expect(draft.modules).toEqual(offeredModules(["flooring"]).filter((m) => company().modules.includes(m)));
    expect(draft.ceiling).toEqual(offeredKeys(["flooring"]));
    expect(draft).toMatchObject({ userLimit: "16", branchLimit: "3" });
  });

  it("sends nothing when nothing changed, whatever the order", () => {
    const draft = draftOf(company());
    expect(accessChanges(company(), { ...draft, ceiling: [...draft.ceiling].reverse() })).toBeNull();
  });

  it("sends only the changed part, as the complete offered list", () => {
    const draft = draftOf(company());
    const ceiling = draft.ceiling.filter((key) => key !== "retail.sample.view");
    const patch = accessChanges(company(), { ...draft, ceiling });
    expect(patch).toEqual({ ceiling: offeredKeys(["flooring"]).filter((key) => key !== "retail.sample.view") });
    expect(patch?.ceiling).not.toContain("installation.job.view");
    expect(patch?.ceiling).toEqual(expect.arrayContaining([...PROTECTED_CEILING_KEYS]));
  });

  it("sends a module change without hidden modules", () => {
    const draft = draftOf(company());
    const patch = accessChanges(company(), { ...draft, modules: draft.modules.filter((m) => m !== "hr") });
    expect(patch?.modules).toContain("platform");
    expect(patch?.modules).not.toContain("hr");
    expect(patch?.modules).not.toContain("installation");
    expect(patch).not.toHaveProperty("ceiling");
  });

  it("sends a limit only when it changed and is a whole number from 1 to 100,000", () => {
    const draft = draftOf(company());
    expect(accessChanges(company(), { ...draft, userLimit: "20" })).toEqual({ userLimit: 20 });
    expect(accessChanges(company(), { ...draft, userLimit: "2.5" })).toBeNull();
    expect(accessChanges(company(), { ...draft, branchLimit: "" })).toBeNull();
    expect(limitProblem("0", 3)).toBe("Enter a whole number from 1 to 100,000.");
    expect(limitProblem("100001", 3)).toBe("Enter a whole number from 1 to 100,000.");
    expect(limitProblem("", 3)).toBe("Enter a whole number from 1 to 100,000.");
    expect(limitProblem("", null)).toBeNull();
    expect(limitProblem("100000", null)).toBeNull();
    // The field and the API's 400 say the same, since both use the shared check.
    const refused = accessPatchProblem({ products: ["flooring"], hasSubscription: true }, { userLimit: 0 });
    expect(limitProblem("0", 3)).toBe(refused?.message);
  });

  it("treats a company with no subscription row as a company with no plan", () => {
    expect(hasPlan(company())).toBe(true);
    expect(hasPlan(company({ subscriptions: [], userLimit: null, branchLimit: null }))).toBe(false);
    expect(draftOf(company({ userLimit: null }))).toMatchObject({ userLimit: "" });
  });

  it("refuses a save before the step-up with the API's own message", () => {
    const keys = offeredKeys(["flooring"]);
    const withoutUsers = keys.filter((key) => key !== "settings.users.manage");
    expect(saveProblem(company(), { ceiling: withoutUsers })).toBe(
      accessPatchProblem({ products: ["flooring"], hasSubscription: true }, { ceiling: withoutUsers })?.message,
    );
    expect(saveProblem(company(), { ceiling: withoutUsers })).toMatch(/always keeps the Users/);
    expect(saveProblem(company(), { ceiling: keys.filter((key) => key !== "retail.sample.view") })).toBeNull();
    expect(saveProblem(company({ subscriptions: [] }), { userLimit: 5 })).toBe(ACCESS_NO_PLAN_MESSAGE);
    expect(ACCESS_NO_PLAN_MESSAGE).not.toMatch(/trial/i);
  });
});

describe("demo console", () => {
  it("keeps hidden modules and their keys as stored when a change covers the offered ones", () => {
    const before = demoCompany();
    const after = withAccess(before, {
      modules: offeredModules(["flooring"]).filter((m) => m !== "hr"),
      ceiling: offeredKeys(["flooring"]).filter((key) => key !== "retail.sample.view"),
    });
    expect(after.modules).toContain("installation");
    expect(after.modules).not.toContain("hr");
    expect(after.modules).toContain("wholesale");
    expect(after.ceiling).toContain("installation.job.view");
    expect(after.ceiling).not.toContain("retail.sample.view");
    expect(after.userLimit).toBe(16);
  });

  it("changes only what the patch names", () => {
    const before = demoCompany();
    expect(withAccess(before, { branchLimit: 5 })).toEqual({ ...before, branchLimit: 5 });
  });

  it("shows a demo company with its plan, members and no database row", () => {
    const facts = { legalName: "Summit Floor Co. LLC", timeZone: "America/Denver", members: 9 };
    expect(demoSummary(demoCompany(), facts)).toMatchObject({
      id: "summit",
      products: ["flooring"],
      phase: "full",
      members: 9,
      userLimit: 16,
      database: { status: null, schemaVersion: null, hasError: false, errorCode: null },
    });
    const detail = demoDetail(demoCompany(), facts, "2026-12-15");
    expect(hasPlan(detail)).toBe(true);
    expect(detail.subscriptions[0]).toMatchObject({
      planName: "Flooring Pro",
      price: "0.00",
      currentPeriodStart: "2026-12-01T00:00:00.000Z",
      currentPeriodEnd: "2027-01-01T00:00:00.000Z",
    });
    expect(demoSubscription({ ...demoCompany(), status: "suspended" }, "2026-11-15").status).toBe("active");
  });
});

describe("platform gate", () => {
  it("opens the console only for an owner or support admin", () => {
    expect(platformGateOf(200, { role: "owner" })).toEqual({ kind: "admin", role: "owner" });
    expect(platformGateOf(200, { role: "support" })).toEqual({ kind: "admin", role: "support" });
    expect(platformGateOf(200, { role: "billing" })).toEqual({ kind: "not_admin" });
    expect(platformGateOf(200, null)).toEqual({ kind: "not_admin" });
  });

  it("sends the signed-out and MFA enrolment to sign-in, a switched-off feature to not found", () => {
    expect(platformGateOf(401, { code: "unauthenticated" })).toEqual({ kind: "signed_out" });
    expect(platformGateOf(403, { code: "mfa_enrolment_required" })).toEqual({ kind: "signed_out" });
    expect(platformGateOf(404, { code: "not_found" })).toEqual({ kind: "off" });
  });

  it("denies anything else", () => {
    expect(platformGateOf(403, { code: "forbidden" })).toEqual({ kind: "not_admin" });
    expect(platformGateOf(500, {})).toEqual({ kind: "not_admin" });
  });
});
