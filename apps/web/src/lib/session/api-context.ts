import type { CompanyId, DefaultRoleKey, ProductKey } from "@workspace/shared";
import { loadCompanyFixtures } from "@/lib/api/demo/fixtures";
import type { CompanySession } from "./session";

/** A company as GET /auth/context returns it; the id is the tenant id. */
export interface ContextCompany {
  id: string;
  slug: string;
  name: string;
}

/** Where the user stands on MFA (blueprint p27). `enrolment_required`: set up a second factor first. */
export interface ContextMfa {
  required: boolean;
  totp: boolean;
  passkeys: number;
  state: "ok" | "enrolment_required";
}

/**
 * GET /auth/context: who is signed in, the open company (null until chosen), their companies and
 * their MFA state.
 */
export interface SessionContext {
  user: { id: string; name: string; email: string };
  company: ContextCompany | null;
  companies: ContextCompany[];
  mfa: ContextMfa;
}

const DEMO_COMPANY_IDS: readonly string[] = ["summit", "keystone", "harbor"] satisfies CompanyId[];

/**
 * Bridges a real session to the workspace session the screens already use, until Settings → Users
 * moves to the API (P10). Screens still read company data from DemoStore, so the signed-in user is
 * matched to their seeded profile by email, and the company by slug. Returns null when the
 * account has no profile there yet, or while the user must set up MFA before using the app.
 */
export async function toCompanySession(context: SessionContext, product: ProductKey): Promise<CompanySession | null> {
  const company = context.company;
  if (context.mfa.state === "enrolment_required") return null;
  if (!company || !DEMO_COMPANY_IDS.includes(company.slug)) return null;
  const fixtures = await loadCompanyFixtures(company.slug as CompanyId);
  const email = context.user.email.toLowerCase();
  const profile = fixtures.users.find((candidate) => candidate.email.toLowerCase() === email);
  const role = fixtures.roles.find((candidate) => profile?.roleIds.includes(candidate.id));
  if (!profile || !role) return null;
  return {
    kind: "company",
    companyId: company.slug as CompanyId,
    product,
    userId: profile.id,
    roleKey: role.key as DefaultRoleKey,
  };
}
