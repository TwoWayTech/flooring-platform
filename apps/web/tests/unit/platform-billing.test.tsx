import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_REASON_MESSAGE,
  BILLING_AUDIT_ACTIONS,
  companyStatusView,
  FEATURES,
  PLAN_MESSAGES,
  STATUS_ACTION_MESSAGES,
  type PlatformCompany,
  type PlatformPlan,
  type PlatformPlanInput,
} from "@workspace/shared";
import { auditActionOptions } from "@/features/admin/audit-labels";
import { CompanyAdminNav } from "@/features/admin/company-admin-nav";
import { CompanyStatusView } from "@/features/admin/company-status-page";
import { planActiveText } from "@/features/admin/plan-active-dialog";
import { PlanFormFields } from "@/features/admin/plan-dialog";
import { emptyPlanDraft, newPlanStep, planDraftOf, planPatchStep, type PlanDraft } from "@/features/admin/plan-draft";
import { PlansView } from "@/features/admin/plans-page";
import { PlatformNav } from "@/features/admin/platform-nav";
import { refusalClosesDialog, statusDoneText, statusStep } from "@/features/admin/status-action-flow";
import type { ApiClient } from "@/lib/api/contract";
import { DemoRefusal, DemoRuleError } from "@/lib/api/demo/admin-rules";
import { ApiError, apiErrorCode } from "@/lib/api/errors";
import { API_METHODS } from "@/lib/api/http/api-methods";
import { routeClient } from "@/lib/api/http/router";
import { HttpApiError, HttpTransport } from "@/lib/api/http/transport";

// The table and the tabs read the address; outside Next.js the router hooks have no app.
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/plans",
  useRouter: () => ({ replace: () => undefined, push: () => undefined, refresh: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

const PLAN_ID = "0195f3a2-7b1c-7d4e-8f00-00000000aaaa";
const COMPANY_ID = "0195f3a2-7b1c-7d4e-8f00-1234567890ab";
const REASON = "Owner asked by phone to pause the account";

interface Sent {
  url: string;
  method: string;
  body: unknown;
}

/** A client whose part 2 methods go over a fake fetch that records each request and answers `status`. */
function httpClient(status = 200, answer: unknown = {}) {
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

/** Runs `check` with a switch flipped, then puts it back. */
function withSwitch(key: keyof typeof FEATURES, enabled: boolean, check: () => void) {
  const feature = FEATURES[key] as { enabled: boolean };
  const was = feature.enabled;
  feature.enabled = enabled;
  try {
    check();
  } finally {
    feature.enabled = was;
  }
}

/** A plan as GET /platform/plans answers it. */
function plan(overrides: Partial<PlatformPlan> = {}): PlatformPlan {
  return {
    id: PLAN_ID,
    key: "flooring-pro",
    name: "Flooring Pro",
    product: "flooring",
    monthlyPrice: "0.00",
    yearlyPrice: "0.00",
    modules: ["core", "retail", "installation", "contracts", "hr", "meetings"],
    maxUsers: 16,
    maxBranches: 3,
    active: true,
    companies: 1,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    ...overrides,
  };
}

/** A complete new plan's draft, as the admin would type it. */
function draft(overrides: Partial<PlanDraft> = {}): PlanDraft {
  return {
    ...emptyPlanDraft(),
    key: "starter",
    name: "Starter",
    product: "flooring",
    monthlyPrice: "49.00",
    yearlyPrice: "490.00",
    modules: ["core", "retail"],
    maxUsers: "5",
    maxBranches: "1",
    reason: REASON,
    ...overrides,
  };
}

/** Summit as GET /platform/companies/:id answers it. */
function company(): PlatformCompany {
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
    modules: ["platform", "core", "retail"],
    userLimit: 16,
    branchLimit: 3,
    members: 9,
    database: { status: "ready", schemaVersion: "0007", hasError: false, errorCode: null },
    legalName: "Summit Floor Co. LLC",
    timeZone: "America/Denver",
    region: "us",
    createdAt: "2025-07-01T00:00:00.000Z",
    ceiling: [],
    subscriptions: [],
  };
}

const NOW = new Date("2026-11-15T12:00:00.000Z");

/** Summit's preview while active with a paid row ending on 2027-01-14 (the shared rule's own answer). */
function activePreview() {
  return companyStatusView(COMPANY_ID, "active", {
    statusChangedAt: new Date("2026-11-01T00:00:00.000Z"),
    subscriptions: [
      { status: "active", currentPeriodEnd: new Date("2027-01-14T12:00:00.000Z"), price: "0.00", deleted: false },
    ],
    now: NOW,
  });
}

/** Every `<button>` tag of some markup whose text holds `label`. */
function buttons(html: string, label: string): string[] {
  return [...html.matchAll(/<button\b[^>]*>(.*?)<\/button>/g)]
    .filter((match) => (match[1] ?? "").includes(label))
    .map((match) => match[0]);
}

/** The opening tags of every switch in some markup. */
function switches(html: string): string[] {
  return html.match(/<button\b[^>]*role="switch"[^>]*>/g) ?? [];
}

/** Whether an opening tag carries the `disabled` attribute (not a `disabled:` class). */
function isDisabled(tag: string | undefined): boolean {
  return / disabled=""/.test(tag ?? "");
}

/** Text as React writes it into markup. */
function escaped(text: string): string {
  return text.replaceAll("'", "&#x27;");
}

describe("plans and company status over HTTP (part 2, W-1)", () => {
  it("lists plans and sends a new plan with its nine fields only", async () => {
    const { client, sent } = httpClient(200, []);
    await client.listPlatformPlans();
    const input = { ...draft(), maxUsers: 5, maxBranches: 1, extra: "dropped" } as unknown as PlatformPlanInput;
    await client.createPlatformPlan(input);
    expect(sent.map(({ method, url }) => `${method} ${url}`)).toEqual([
      "GET http://api.test/platform/plans",
      "POST http://api.test/platform/plans",
    ]);
    expect(sent[1]?.body).toEqual({
      key: "starter",
      name: "Starter",
      product: "flooring",
      monthlyPrice: "49.00",
      yearlyPrice: "490.00",
      modules: ["core", "retail"],
      maxUsers: 5,
      maxBranches: 1,
      reason: REASON,
    });
  });

  it("sends only the fields set on a plan change, and the reason on retire and restore", async () => {
    const { client, sent } = httpClient(200, plan());
    await client.updatePlatformPlan(PLAN_ID, { name: "Flooring Pro Plus", reason: REASON });
    await client.retirePlatformPlan(PLAN_ID, REASON);
    await client.restorePlatformPlan(PLAN_ID, REASON);
    expect(sent).toEqual([
      {
        method: "PATCH",
        url: `http://api.test/platform/plans/${PLAN_ID}`,
        body: { name: "Flooring Pro Plus", reason: REASON },
      },
      { method: "POST", url: `http://api.test/platform/plans/${PLAN_ID}/retire`, body: { reason: REASON } },
      { method: "POST", url: `http://api.test/platform/plans/${PLAN_ID}/restore`, body: { reason: REASON } },
    ]);
  });

  it("never sends a plan id that is not a UUID", async () => {
    const { client, sent } = httpClient();
    await expect(client.updatePlatformPlan("flooring-pro", { reason: REASON })).rejects.toThrow(PLAN_MESSAGES.notFound);
    await expect(client.retirePlatformPlan("../companies", REASON)).rejects.toThrow(PLAN_MESSAGES.notFound);
    await expect(client.restorePlatformPlan("flooring-pro", REASON)).rejects.toThrow(PLAN_MESSAGES.notFound);
    expect(sent).toEqual([]);
  });

  it("reads the status preview, and reads a non-UUID id or any 404 as none", async () => {
    const ok = httpClient(200, activePreview());
    expect(await ok.client.getPlatformCompanyStatus(COMPANY_ID)).toEqual(activePreview());
    expect(ok.sent).toEqual([
      { method: "GET", url: `http://api.test/platform/companies/${COMPANY_ID}/status`, body: undefined },
    ]);
    const missing = httpClient(404, { code: "not_found", message: "Not found" });
    expect(await missing.client.getPlatformCompanyStatus(COMPANY_ID)).toBeNull();
    expect(await missing.client.getPlatformCompanyStatus("summit")).toBeNull();
    expect(missing.sent).toHaveLength(1);
    const refused = httpClient(403, { code: "forbidden", message: "Only platform admins can use this." });
    await expect(refused.client.getPlatformCompanyStatus(COMPANY_ID)).rejects.toBeInstanceOf(HttpApiError);
  });

  it("sends each status action with the status seen, and the typed name for cancel only", async () => {
    const { client, sent } = httpClient(200, company());
    await client.changePlatformCompanyStatus(COMPANY_ID, {
      action: "suspend",
      reason: REASON,
      expectedStatus: "active",
      confirmName: "Summit Floor Co.",
    });
    await client.changePlatformCompanyStatus(COMPANY_ID, { action: "reinstate", reason: REASON, expectedStatus: "x" });
    await client.changePlatformCompanyStatus(COMPANY_ID, {
      action: "cancel",
      reason: REASON,
      expectedStatus: "active",
      confirmName: "Summit Floor Co.",
    });
    expect(sent).toEqual([
      {
        method: "POST",
        url: `http://api.test/platform/companies/${COMPANY_ID}/suspend`,
        body: { reason: REASON, expectedStatus: "active" },
      },
      {
        method: "POST",
        url: `http://api.test/platform/companies/${COMPANY_ID}/reinstate`,
        body: { reason: REASON, expectedStatus: "x" },
      },
      {
        method: "POST",
        url: `http://api.test/platform/companies/${COMPANY_ID}/cancel`,
        body: { reason: REASON, expectedStatus: "active", confirmName: "Summit Floor Co." },
      },
    ]);
    const demo = httpClient();
    await expect(
      demo.client.changePlatformCompanyStatus("summit", {
        action: "suspend",
        reason: REASON,
        expectedStatus: "active",
      }),
    ).rejects.toThrow("That company does not exist.");
    expect(demo.sent).toEqual([]);
  });

  it("reads the code of an API refusal and of a demo refusal, and none of anything else", () => {
    expect(apiErrorCode(new HttpApiError("Changed meanwhile", 409, "conflict"))).toBe("conflict");
    expect(apiErrorCode(new DemoRefusal("In use", "rule_broken"))).toBe("rule_broken");
    expect(apiErrorCode(new DemoRuleError("This feature is switched off."))).toBeNull();
    expect(apiErrorCode(new ApiError("Plain"))).toBeNull();
    expect(apiErrorCode(new Error("Not an API error"))).toBeNull();
    expect(apiErrorCode("conflict")).toBeNull();
  });
});

describe("plans page (W-2)", () => {
  const noop = () => undefined;

  it("offers the support role no write and says why", () => {
    const html = renderToStaticMarkup(
      <PlansView role="support" plans={[plan()]} onNew={noop} onEdit={noop} onActive={noop} />,
    );
    expect(html).toContain("Read only: only the platform owner role can change plans.");
    expect(html).toContain('role="note"');
    for (const label of ["New plan", "Edit", "Retire", "Restore"]) expect(buttons(html, label)).toEqual([]);
    expect(html).toContain("Flooring Pro");
    expect(html).toContain("Installation (hidden)");
  });

  it("offers the owner role New plan and each row's Edit and Retire or Restore", () => {
    const html = renderToStaticMarkup(
      <PlansView
        role="owner"
        plans={[plan(), plan({ id: "retired", key: "old", name: "Old", active: false, companies: 0, maxUsers: null })]}
        onNew={noop}
        onEdit={noop}
        onActive={noop}
      />,
    );
    expect(html).not.toContain("Read only:");
    expect(buttons(html, "New plan")).toHaveLength(1);
    expect(buttons(html, "Edit")).toHaveLength(2);
    expect(buttons(html, "Retire")).toHaveLength(1);
    expect(buttons(html, "Restore")).toHaveLength(1);
    expect(html).toContain("No limit");
    expect(html).toContain("In use");
  });
});

describe("plan dialog (W-3)", () => {
  it("refuses a bad price with the shared rule before any code is asked for", () => {
    expect(newPlanStep(draft({ monthlyPrice: "49,00" }))).toEqual({
      ok: false,
      field: "monthlyPrice",
      message: PLAN_MESSAGES.monthlyPrice,
    });
    expect(newPlanStep(draft({ yearlyPrice: "1e3" }))).toMatchObject({ ok: false, field: "yearlyPrice" });
    expect(newPlanStep(draft({ product: "" }))).toMatchObject({ ok: false, field: "product" });
    expect(newPlanStep(draft({ modules: [] }))).toMatchObject({ ok: false, field: "modules" });
    expect(newPlanStep(draft({ maxUsers: "5", maxBranches: "1e3" }))).toMatchObject({
      ok: false,
      field: "maxBranches",
    });
    expect(newPlanStep(draft({ maxUsers: "" }))).toMatchObject({ ok: false, field: "maxUsers" });
    expect(newPlanStep(draft({ reason: "too short" }))).toEqual({
      ok: false,
      field: "reason",
      message: ADMIN_REASON_MESSAGE,
    });
  });

  it("sends a new plan with the prices as typed and the reason trimmed", () => {
    expect(newPlanStep(draft({ monthlyPrice: "49", reason: `  ${REASON}  ` }))).toEqual({
      ok: true,
      value: {
        key: "starter",
        name: "Starter",
        product: "flooring",
        monthlyPrice: "49",
        yearlyPrice: "490.00",
        modules: ["core", "retail"],
        maxUsers: 5,
        maxBranches: 1,
        reason: REASON,
      },
    });
  });

  it("sends only what changed on a plan, nothing when nothing did, and refuses modules of a plan in use", () => {
    const stored = plan();
    const start = { ...planDraftOf(stored), reason: REASON };
    // A hidden stored module is not offered, so it is neither shown nor sent; the API keeps it.
    expect(start.modules).not.toContain("installation");
    expect(planPatchStep(stored, start)).toEqual({ ok: true, value: null });
    expect(planPatchStep(stored, { ...start, monthlyPrice: "0" })).toEqual({ ok: true, value: null });
    expect(planPatchStep(stored, { ...start, name: "Flooring Pro Plus", monthlyPrice: "59.00" })).toEqual({
      ok: true,
      value: { name: "Flooring Pro Plus", monthlyPrice: "59.00", reason: REASON },
    });
    expect(planPatchStep(stored, { ...start, modules: ["core"] })).toEqual({
      ok: false,
      field: null,
      message: PLAN_MESSAGES.inUse,
    });
    expect(planPatchStep(plan({ companies: 0 }), { ...start, maxUsers: "20" })).toEqual({
      ok: true,
      value: { maxUsers: 20, reason: REASON },
    });
  });

  it("locks a plan in use's modules and limits and says what a rename and a price reach", () => {
    const inUse = plan({ companies: 2 });
    const html = renderToStaticMarkup(
      <PlanFormFields
        target={{ kind: "edit", plan: inUse }}
        draft={planDraftOf(inUse)}
        error={null}
        onChange={() => undefined}
      />,
    );
    expect(html).toContain("In use by 2 companies: its modules and limits can&#x27;t change.");
    expect(html).toContain(escaped(PLAN_MESSAGES.inUseEffect));
    const toggles = switches(html);
    expect(toggles.length).toBeGreaterThan(2);
    expect(toggles.every(isDisabled)).toBe(true);
    expect(html).toMatch(/<input[^>]*id="plan-maxUsers"[^>]*disabled/);
    expect(html).toMatch(/<input[^>]*id="plan-maxBranches"[^>]*disabled/);

    const free = plan({ companies: 0 });
    const open = renderToStaticMarkup(
      <PlanFormFields
        target={{ kind: "edit", plan: free }}
        draft={planDraftOf(free)}
        error={null}
        onChange={() => undefined}
      />,
    );
    expect(open).not.toContain("In use by");
    // Only the Platform switch stays fixed.
    expect(switches(open).filter(isDisabled)).toHaveLength(1);
  });

  it("marks and describes the field in error", () => {
    const html = renderToStaticMarkup(
      <PlanFormFields
        target={{ kind: "new" }}
        draft={draft()}
        error={{ field: "monthlyPrice", message: PLAN_MESSAGES.monthlyPrice }}
        onChange={() => undefined}
      />,
    );
    expect(html).toMatch(
      /<input[^>]*aria-invalid="true"[^>]*id="plan-monthlyPrice"|id="plan-monthlyPrice"[^>]*aria-invalid="true"/,
    );
    expect(html).toContain('id="plan-monthlyPrice-error"');
    expect(html).toContain('inputMode="decimal"');
  });

  it("says retiring changes no company", () => {
    expect(planActiveText(plan()).body).toBe(
      "Retiring hides nothing and changes no company today: companies on Flooring Pro keep it. It marks the plan as not offered for new subscriptions, which the console can't create yet.",
    );
    expect(planActiveText(plan({ active: false })).title).toBe("Restore Flooring Pro?");
  });
});

describe("company status page (W-4, W-6)", () => {
  const noop = () => undefined;

  it("shows a refused action disabled with its message, and an allowed one with what it gives", () => {
    const html = renderToStaticMarkup(
      <CompanyStatusView company={company()} status={activePreview()} role="owner" onAct={noop} onRetry={noop} />,
    );
    const [reinstate] = buttons(html, "Reinstate");
    expect(isDisabled(reinstate)).toBe(true);
    expect(html).toContain(escaped(STATUS_ACTION_MESSAGES.notStopped));
    const [suspend] = buttons(html, "Suspend");
    expect(isDisabled(suspend)).toBe(false);
    expect(suspend).toContain('aria-describedby="status-suspend-text"');
    // statusActionText on the preview's `next`: the paid row locks 44 days after it ends.
    expect(html).toContain("Read only from now: its people can sign in, read and export, but not change anything.");
    expect(html).toContain("It locks on Feb 27, 2027.");
    expect(html).toContain("Nothing is deleted: its database, people, plans and settings stay.");
    expect(html).toContain(
      "Subscriptions, payments and period corrections wait for the owner&#x27;s billing decisions.",
    );
  });

  it("gives the support role no button and says why", () => {
    const html = renderToStaticMarkup(
      <CompanyStatusView company={company()} status={activePreview()} role="support" onAct={noop} onRetry={noop} />,
    );
    expect(html).toContain("Read only: only the platform owner role can change a company&#x27;s status.");
    for (const label of ["Suspend", "Reinstate", "Cancel"]) expect(buttons(html, label)).toEqual([]);
  });

  it("tells a missing company from a status that can't be read", () => {
    const missing = renderToStaticMarkup(
      <CompanyStatusView company={null} status={null} role="owner" onAct={noop} onRetry={noop} />,
    );
    expect(missing).toContain("This company does not exist.");
    const unread = renderToStaticMarkup(
      <CompanyStatusView company={company()} status={null} role="owner" onAct={noop} onRetry={noop} />,
    );
    expect(unread).toContain("The company&#x27;s status can&#x27;t be read right now.");
    expect(unread).not.toContain("This company does not exist.");
  });

  it("needs the company's name typed exactly before a cancel goes on", () => {
    const typed = (confirmName: string) =>
      statusStep("cancel", { reason: REASON, confirmName }, "active", "Summit Floor Co.");
    expect(typed("summit floor co.")).toEqual({
      ok: false,
      field: "confirmName",
      message: STATUS_ACTION_MESSAGES.confirmName,
    });
    expect(typed("")).toMatchObject({ ok: false, field: "confirmName" });
    expect(typed(" Summit Floor Co. ")).toEqual({
      ok: true,
      input: { action: "cancel", reason: REASON, expectedStatus: "active", confirmName: " Summit Floor Co. " },
    });
    expect(statusStep("suspend", { reason: "short", confirmName: "" }, "active", "Summit")).toEqual({
      ok: false,
      field: "reason",
      message: ADMIN_REASON_MESSAGE,
    });
    expect(statusStep("suspend", { reason: REASON, confirmName: "ignored" }, "active", "Summit")).toEqual({
      ok: true,
      input: { action: "suspend", reason: REASON, expectedStatus: "active" },
    });
  });

  it("says what each action did, and closes on a 409 or 422 only", () => {
    expect(statusDoneText("suspend", "Summit Floor Co.")).toBe("Summit Floor Co. is suspended.");
    expect(statusDoneText("reinstate", "Summit Floor Co.")).toBe("Summit Floor Co. is reinstated.");
    expect(statusDoneText("cancel", "Summit Floor Co.")).toBe("Summit Floor Co. is cancelled. Nothing was deleted.");
    expect(refusalClosesDialog(new HttpApiError(STATUS_ACTION_MESSAGES.changedMeanwhile, 409, "conflict"))).toBe(true);
    expect(refusalClosesDialog(new HttpApiError(STATUS_ACTION_MESSAGES.widens, 422, "rule_broken"))).toBe(true);
    expect(refusalClosesDialog(new DemoRefusal(STATUS_ACTION_MESSAGES.alreadySuspended, "conflict"))).toBe(true);
    expect(refusalClosesDialog(new HttpApiError(ADMIN_REASON_MESSAGE, 400, "invalid_request"))).toBe(false);
    expect(refusalClosesDialog(new HttpApiError("Step up first", 403, "step_up_required"))).toBe(false);
    expect(refusalClosesDialog(new DemoRuleError(STATUS_ACTION_MESSAGES.confirmName))).toBe(false);
    // The text alone decides nothing.
    expect(refusalClosesDialog(new ApiError(STATUS_ACTION_MESSAGES.changedMeanwhile))).toBe(false);
  });
});

describe("admin.billing switched off (W-5)", () => {
  it("takes away the Plans nav item, the Status tab and the seven audit filters", () => {
    withSwitch("admin.billing", false, () => {
      const nav = renderToStaticMarkup(<PlatformNav />);
      expect(nav).toContain("Companies");
      expect(nav).toContain("Audit log");
      expect(nav).not.toContain("Plans");
      const tabs = renderToStaticMarkup(<CompanyAdminNav companyId="summit" />);
      expect(tabs).toContain("Access");
      expect(tabs).toContain("Support");
      expect(tabs).not.toContain("Status");
      const options = auditActionOptions().map((option) => option.value);
      expect(options).toHaveLength(6);
      expect(options.some((action) => BILLING_AUDIT_ACTIONS.includes(action))).toBe(false);
    });
  });

  it("offers them while it is on, Plans current on its page", () => {
    withSwitch("admin.billing", true, () => {
      const nav = renderToStaticMarkup(<PlatformNav />);
      expect(nav).toMatch(
        /<a[^>]*href="\/admin\/plans"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/admin\/plans"/,
      );
      const tabs = renderToStaticMarkup(<CompanyAdminNav companyId="summit" />);
      expect(tabs.indexOf("Access")).toBeLessThan(tabs.indexOf("Status"));
      expect(tabs.indexOf("Status")).toBeLessThan(tabs.indexOf("Support"));
      expect(auditActionOptions()).toHaveLength(13);
    });
  });
});
