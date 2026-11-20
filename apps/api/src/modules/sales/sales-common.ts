import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { ControlDb } from "@workspace/db";
import { tenants } from "@workspace/db/control";
import { dayInZone, featureOn, scopeAllows, type Customer, type FeatureKey } from "@workspace/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";

/** A day as the screens send it, `yyyy-MM-dd`. */
export const DAY = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
  }, "Enter a real date.");

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

/** The company's time zone and today in it: the business day every sales date is read in. */
export interface CompanyClock {
  /** Today in the company's time zone, `yyyy-MM-dd`. */
  day: string;
  /** An IANA time zone such as America/Chicago. */
  zone: string;
  /** The moment `day` was read at; documents stamped with it read back as `day` (PR #18 review). */
  now: Date;
}

/** The company's clock, from its time zone in the control database (quotes, invoices, payments). */
export async function companyClock(control: ControlDb, tenant: TenantContext): Promise<CompanyClock> {
  const [company] = await control
    .select({ timeZone: tenants.timeZone })
    .from(tenants)
    .where(eq(tenants.id, tenant.companyId));
  // TenantContext is built from this row, so a missing one is a fault, not a reason to use UTC.
  if (!company) throw new Error(`Company ${tenant.companyId} has no control row.`);
  const now = new Date();
  return { day: dayIn(now, company.timeZone), zone: company.timeZone, now };
}

/** Today in the company's own time zone, read from the control database (quotes, invoices, payments). */
export async function companyToday(control: ControlDb, tenant: TenantContext): Promise<string> {
  return (await companyClock(control, tenant)).day;
}

/**
 * The company's day a moment falls on. Invoices keep the moment they were issued, sent or voided;
 * read as a UTC day, an invoice issued after 6 pm in Chicago would read as tomorrow, and a payment
 * made that evening would be refused as "before the invoice date". The shared `dayInZone`, which the
 * web's `today()` reads too, so a form's default date is the day this API accepts.
 */
export function dayIn(moment: Date, zone: string): string {
  return dayInZone(moment, zone);
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
