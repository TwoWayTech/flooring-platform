import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { ControlDb } from "@workspace/db";
import { tenants } from "@workspace/db/control";
import { featureOn, scopeAllows, type Customer, type FeatureKey } from "@workspace/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";

/** A day as the screens send it, `yyyy-MM-dd`. */
export const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.");

/** A switched-off feature is hidden everywhere, the API included (CLAUDE.md rule 13): 404. */
export function requireFeature(key: FeatureKey): void {
  if (!featureOn(key)) throw new NotFoundException();
}

/** A request the sales rules refuse: 400 `invalid_request` with the rule's own words. */
export function refuse(message: string): BadRequestException {
  return new BadRequestException({ code: "invalid_request", message });
}

/** A record that is gone, or outside the person's data scope: 404, so neither case reveals the other. */
export function notFound(what: string): NotFoundException {
  return new NotFoundException({ code: "not_found", message: `This ${what} no longer exists.` });
}

/** Today in a time zone, as the shared rules compare dates (`yyyy-MM-dd`). */
export function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );
}

/** Today in the company's own time zone, read from the control database (quotes, invoices, payments). */
export async function companyToday(control: ControlDb, tenant: TenantContext): Promise<string> {
  const [company] = await control
    .select({ timeZone: tenants.timeZone })
    .from(tenants)
    .where(eq(tenants.id, tenant.companyId));
  return todayIn(company?.timeZone ?? "UTC");
}

/**
 * Whether the person's data scope covers a quote or invoice (spec "Data scope"): own by the rep,
 * branch by the document's branch, or all.
 */
export function seesDocument(access: RequestAccess, document: { salesRepId: string; branchId: string }): boolean {
  return scopeAllows(
    access.dataScope,
    { userId: access.userId, branchId: access.branchId },
    { ownerUserId: document.salesRepId, branchId: document.branchId },
  );
}

/** Whether the person's data scope covers a customer: own by the rep, branch by the rep's branch, or all. */
export function seesCustomer(
  access: RequestAccess,
  customer: Pick<Customer, "salesRepId">,
  branches: ReadonlyMap<string, string | null>,
): boolean {
  return scopeAllows(
    access.dataScope,
    { userId: access.userId, branchId: access.branchId },
    { ownerUserId: customer.salesRepId || null, branchId: branches.get(customer.salesRepId) ?? null },
  );
}
