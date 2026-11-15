import {
  supportGrantDecisionRefusal,
  supportGrantStatus,
  supportRequestFacts,
  supportRequestRefusal,
  type CompanySupportGrant,
  type PlatformSupportGrant,
  type SupportGrantStep,
  type SupportRequestRefusal,
} from "@workspace/shared";
import { DEMO_PLATFORM_ADMIN } from "./platform-audit";

/** The most requests the support list shows, as on the API (spec "GET /platform/support-grants"). */
const MAX_LISTED = 100;

/**
 * One support-access request as the demo keeps it in local storage (key `platform-support`;
 * docs/specs/platform-admin.md, part 3, "Demo mode"). Every demo request is the demo admin's. The
 * company's Owner approves or revokes it in Settings → Users (part 4); otherwise it stays pending
 * until it expires.
 */
export interface DemoSupportGrant {
  id: string;
  companyId: string;
  companyName: string;
  reason: string;
  /** ISO moments. */
  createdAt: string;
  expiresAt: string;
  approvedAt: string | null;
  revokedAt: string | null;
}

function isMoment(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/** Whether a stored value is a demo grant; a hand-edited row that doesn't fit is left out. */
function isDemoSupportGrant(value: unknown): value is DemoSupportGrant {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const grant = value as Record<string, unknown>;
  return (
    typeof grant.id === "string" &&
    typeof grant.companyId === "string" &&
    typeof grant.companyName === "string" &&
    typeof grant.reason === "string" &&
    isMoment(grant.createdAt) &&
    isMoment(grant.expiresAt) &&
    (grant.approvedAt === null || isMoment(grant.approvedAt)) &&
    (grant.revokedAt === null || isMoment(grant.revokedAt))
  );
}

/** The stored grants that fit the demo's shape. */
export function demoGrants(stored: readonly unknown[]): DemoSupportGrant[] {
  return stored.filter(isDemoSupportGrant);
}

/** A company's stored grants, newest first, at most 100, as both lists show them. */
function newestOf(stored: readonly unknown[], companyId: string): DemoSupportGrant[] {
  return demoGrants(stored)
    .filter((grant) => grant.companyId === companyId)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || (a.id < b.id ? 1 : -1))
    .slice(0, MAX_LISTED);
}

/**
 * A company's requests as the console lists them (spec "GET /platform/support-grants"): newest
 * first, at most 100, each with its status derived by the shared `supportGrantStatus`. The demo
 * admin asked for every one of them.
 */
export function demoGrantViews(stored: readonly unknown[], companyId: string, now: Date): PlatformSupportGrant[] {
  return newestOf(stored, companyId).map((grant) => ({
    id: grant.id,
    company: { id: grant.companyId, name: grant.companyName },
    admin: { userId: DEMO_PLATFORM_ADMIN.userId, name: DEMO_PLATFORM_ADMIN.name },
    mine: true,
    reason: grant.reason,
    requestedAt: grant.createdAt,
    expiresAt: grant.expiresAt,
    approvedAt: grant.approvedAt,
    revokedAt: grant.revokedAt,
    status: supportGrantStatus(grant, now),
  }));
}

/**
 * Why the limits refuse the demo admin's next request for `companyId` (spec "The limits"), with the
 * API's shared facts and refusal: an open request for the company (409), then 10 in 24 hours (429).
 */
export function demoRequestRefusal(
  stored: readonly unknown[],
  companyId: string,
  now: Date,
): SupportRequestRefusal | null {
  return supportRequestRefusal(supportRequestFacts(demoGrants(stored), companyId, now));
}

/**
 * The open company's requests as its Owner lists them in Settings → Users (docs/specs/platform-admin.md,
 * part 4, "GET /support-grants"): newest first, at most 100, named by the admin who asked, with the
 * shared status. Never the approver or an admin id.
 */
export function demoOwnerGrantViews(stored: readonly unknown[], companyId: string, now: Date): CompanySupportGrant[] {
  return newestOf(stored, companyId).map((grant) => ({
    id: grant.id,
    adminName: DEMO_PLATFORM_ADMIN.name,
    reason: grant.reason,
    requestedAt: grant.createdAt,
    expiresAt: grant.expiresAt,
    status: supportGrantStatus(grant, now),
  }));
}

/** What the Owner's decision on a demo grant gives: the grants to store, or why it is refused. */
export type DemoGrantDecision = { grants: DemoSupportGrant[]; grant: DemoSupportGrant } | { refusal: "grant_closed" };

/**
 * The Owner approves or revokes one of the open company's grants (spec part 4, "Demo mode"), on the
 * shared `supportGrantDecisionRefusal`, as the API's conditional update does: approving needs a
 * pending grant, revoking a pending or approved one, each unexpired. Another company's grant, or an
 * id that names none, is closed too, so it reveals nothing.
 */
export function demoGrantDecision(
  stored: readonly unknown[],
  companyId: string,
  grantId: string,
  step: SupportGrantStep,
  now: Date,
): DemoGrantDecision {
  const grants = demoGrants(stored);
  const target = grants.find((grant) => grant.id === grantId && grant.companyId === companyId);
  if (!target || supportGrantDecisionRefusal(target, step, now)) return { refusal: "grant_closed" };
  const at = now.toISOString();
  const grant: DemoSupportGrant = step === "approve" ? { ...target, approvedAt: at } : { ...target, revokedAt: at };
  return { grants: grants.map((each) => (each.id === grant.id ? grant : each)), grant };
}
