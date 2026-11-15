import { ForbiddenException, type ExecutionContext } from "@nestjs/common";
import { ROUTE_ARGS_METADATA } from "@nestjs/common/constants";
import { PRODUCT_HEADER } from "@workspace/shared";
import { describe, expect, it, vi } from "vitest";
import { PlanLimits } from "../src/core/access/plan-limits";
import type { AuthSession } from "../src/core/auth/session.service";
import { TENANCY_REFUSALS } from "../src/core/tenancy/tenant.guard";
import { TenantDirectory, type CompanyAccess } from "../src/core/tenancy/tenant-directory";
import { BillingFacts } from "../src/modules/billing/billing-facts";
import { BillingService } from "../src/modules/billing/billing.service";
import { MemberCompany, StandingMemberGuard } from "../src/modules/billing/company-standing.guard";

const COMPANY: CompanyAccess = {
  id: "c1",
  status: "active",
  products: ["flooring"],
  maintenanceMode: false,
  phase: "full",
  databaseStatus: "ready",
};

function sessionFor(companyId: string | null): AuthSession {
  return {
    user: { id: "u1", name: "Pat Member", email: "pat@example.test" },
    sessionId: "s1",
    sessionCreatedAt: new Date(),
    companyId,
    mfa: { required: false, totp: false, passkeys: 0, state: "ok" },
  };
}

/** A request as the guard reads it, after SessionGuard. */
interface ProbeRequest {
  authSession?: AuthSession;
  headers: Record<string, string>;
  standingCompany?: CompanyAccess;
}

function requestFor(companyId: string | null, product?: string): ProbeRequest {
  return { authSession: sessionFor(companyId), headers: product ? { [PRODUCT_HEADER]: product } : {} };
}

function contextFor(request: ProbeRequest): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

/** The guard with a directory that knows `company` (or none) and answers `member`. */
function guardFor(company: CompanyAccess | null, member = true) {
  const directory = { access: vi.fn(async () => company), isMember: vi.fn(async () => member) };
  return { guard: new StandingMemberGuard(directory as unknown as TenantDirectory), directory };
}

/** The status and body a refusal sends, or null when the guard lets the request through. */
async function outcome(promise: Promise<boolean>): Promise<{ status: number; body: unknown } | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof ForbiddenException) return { status: error.getStatus(), body: error.getResponse() };
    throw error;
  }
}

function refusal(code: keyof typeof TENANCY_REFUSALS) {
  return { status: 403, body: { code, message: TENANCY_REFUSALS[code] } };
}

/** The factory `@MemberCompany()` runs for a handler parameter, as Nest calls it. */
function memberCompanyFactory(): (data: unknown, context: ExecutionContext) => unknown {
  class Probe {
    read() {}
  }
  MemberCompany()(Probe.prototype, "read", 0);
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, "read") as Record<
    string,
    { factory: (data: unknown, context: ExecutionContext) => unknown }
  >;
  return Object.values(args)[0].factory;
}

/**
 * StandingMemberGuard on its own (docs/specs/platform-admin.md, part 4, "GET /company/standing";
 * ADR 0054): TenantGuard's membership refusals, in TenantGuard's order, from control rows only.
 */
describe("StandingMemberGuard (platform admin part 4)", () => {
  it("refuses in TenantGuard's order: no company, an unknown company, not a member, then the product", async () => {
    const none = guardFor(COMPANY);
    expect(await outcome(none.guard.canActivate(contextFor(requestFor(null, "hr"))))).toEqual(
      refusal("company_required"),
    );
    expect(none.directory.access).not.toHaveBeenCalled();

    const unknown = guardFor(null);
    expect(await outcome(unknown.guard.canActivate(contextFor(requestFor("c1", "hr"))))).toEqual(
      refusal("company_required"),
    );
    expect(unknown.directory.isMember).not.toHaveBeenCalled();

    const outsider = guardFor(COMPANY, false);
    expect(await outcome(outsider.guard.canActivate(contextFor(requestFor("c1", "hr"))))).toEqual(
      refusal("not_a_member"),
    );
    expect(outsider.directory.isMember).toHaveBeenCalledWith("u1", "c1");

    const member = guardFor(COMPANY);
    expect(await outcome(member.guard.canActivate(contextFor(requestFor("c1", "hr"))))).toEqual(
      refusal("product_not_enabled"),
    );
  });

  it("asks the directory for the session's company only, whatever the request names", async () => {
    const { guard, directory } = guardFor(COMPANY);
    const request = { ...requestFor("c1"), headers: { "x-company-id": "c2", "x-tenant-id": "c2" } };
    expect(await outcome(guard.canActivate(contextFor(request)))).toBeNull();
    expect(directory.access).toHaveBeenCalledExactlyOnceWith("c1");
  });

  it("lets a member through with no product header, the company's product or a header naming no product", async () => {
    for (const product of [undefined, "flooring", "other"]) {
      const { guard } = guardFor(COMPANY);
      const request = requestFor("c1", product);
      expect(await guard.canActivate(contextFor(request))).toBe(true);
      expect(request.standingCompany).toBe(COMPANY);
    }
  });

  it("lets a member through in every state, because the handler answers with the state", async () => {
    const states: CompanyAccess[] = [
      { ...COMPANY, maintenanceMode: true },
      { ...COMPANY, databaseStatus: null },
      { ...COMPANY, databaseStatus: "failed" },
      { ...COMPANY, phase: "locked" },
      { ...COMPANY, phase: "read_only" },
    ];
    for (const company of states) {
      const { guard } = guardFor(company);
      expect(await guard.canActivate(contextFor(requestFor("c1")))).toBe(true);
    }
  });

  it("throws, never lets through, when SessionGuard did not run", async () => {
    const { guard } = guardFor(COMPANY);
    await expect(guard.canActivate(contextFor({ headers: {} }))).rejects.toThrow(/SessionGuard must run first/);
  });

  it("hands the checked company to @MemberCompany(), and fails loudly without the guard", async () => {
    const factory = memberCompanyFactory();
    const { guard } = guardFor(COMPANY);
    const request = requestFor("c1");
    await guard.canActivate(contextFor(request));
    expect(factory(undefined, contextFor(request))).toBe(COMPANY);
    expect(() => factory(undefined, contextFor(requestFor("c1")))).toThrow("StandingMemberGuard must run first.");
  });

  it("injects only control-database readers: no TenantConnectionService and no company database", () => {
    expect(Reflect.getMetadata("design:paramtypes", StandingMemberGuard)).toEqual([TenantDirectory]);
    expect(Reflect.getMetadata("design:paramtypes", BillingService)).toEqual([BillingFacts, PlanLimits]);
  });
});
