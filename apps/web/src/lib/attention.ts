import {
  daysBetween,
  isOverdue,
  splitOvertime,
  type Access,
  type PermissionKey,
  type ProductKey,
} from "@workspace/shared";
import type { ApiClient } from "./api/contract";

/** Rolls shorter than this are flagged so the warehouse can reorder (spec "Dashboard"). */
export const LOW_ROLL_FT = 20;
/** Certificates expiring within this many days are flagged (spec section 4). */
export const CERTIFICATE_WARNING_DAYS = 30;

/** One thing that needs a person's attention, with where to act on it. */
export interface AttentionItem {
  key: string;
  count: number;
  /** What is counted, without the number, e.g. "overdue invoices". */
  label: string;
  href: string;
  tone: "danger" | "warning" | "brand";
}

interface Check {
  key: string;
  permission: PermissionKey;
  products: ProductKey[];
  load: (client: ApiClient, today: string) => Promise<Omit<AttentionItem, "key">>;
}

/** The noun for a count: "overdue invoice" for 1, "overdue invoices" otherwise. */
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * The "Needs attention" checks (spec "Dashboard": overdue invoices, low rolls, expiring
 * certificates, today's jobs) plus HR approvals. Each runs only for people allowed to act on it.
 */
const CHECKS: Check[] = [
  {
    key: "overdue",
    permission: "sales.invoice.view",
    products: ["flooring"],
    load: async (client, today) => {
      const count = (await client.list("invoices")).filter((i) => isOverdue(i, today)).length;
      return {
        count,
        label: plural(count, "overdue invoice", "overdue invoices"),
        href: "/sales/invoices?status=overdue",
        tone: "danger",
      };
    },
  },
  {
    key: "low-rolls",
    permission: "inventory.roll.view",
    products: ["flooring"],
    load: async (client) => {
      const count = (await client.list("rolls")).filter(
        (r) => !r.isRemnant && Number(r.remainingLengthFt) > 0 && Number(r.remainingLengthFt) < LOW_ROLL_FT,
      ).length;
      return {
        count,
        label: `${plural(count, "roll", "rolls")} under ${LOW_ROLL_FT} ft`,
        href: "/inventory?view=rolls&filter=low",
        tone: "warning",
      };
    },
  },
  {
    key: "certificates",
    permission: "customers.customer.view",
    products: ["flooring"],
    load: async (client, today) => {
      const count = (await client.list("customers")).filter((c) => {
        if (!c.certificate) return false;
        const days = daysBetween(today, c.certificate.expiresAt);
        return days >= 0 && days <= CERTIFICATE_WARNING_DAYS;
      }).length;
      return {
        count,
        label: `${plural(count, "certificate", "certificates")} expiring`,
        href: "/sales/customers?filter=certificates",
        tone: "warning",
      };
    },
  },
  {
    key: "jobs-today",
    permission: "installation.job.view",
    products: ["flooring"],
    load: async (client, today) => {
      const count = (await client.list("jobs")).filter((j) => j.date === today).length;
      return { count, label: `${plural(count, "job", "jobs")} today`, href: "/installation", tone: "brand" };
    },
  },
  {
    key: "pto",
    permission: "hr.pto.approve",
    products: ["flooring", "hr"],
    load: async (client) => {
      const count = (await client.list("ptoRequests")).filter((p) => p.status === "pending").length;
      return {
        count,
        label: `${plural(count, "time-off request", "time-off requests")} to review`,
        href: "/hr/time-off",
        tone: "brand",
      };
    },
  },
  {
    key: "overtime",
    permission: "hr.timesheet.approve",
    products: ["hr"],
    load: async (client) => {
      const sheets = await client.list("timesheets");
      const latest = sheets.reduce((max, t) => (t.weekStart > max ? t.weekStart : max), "");
      const count = sheets.filter(
        (t) => t.weekStart === latest && splitOvertime(t.days, "federal").overtime > 0,
      ).length;
      return {
        count,
        label: `${plural(count, "timesheet", "timesheets")} with overtime this week`,
        href: "/hr/timesheets",
        tone: "warning",
      };
    },
  },
];

/** Attention items for the viewer, skipping checks they cannot act on and checks with nothing to show. */
export async function loadAttention(client: ApiClient, access: Access, product: ProductKey): Promise<AttentionItem[]> {
  const today = client.today();
  const allowed = CHECKS.filter((c) => c.products.includes(product) && access.permissions.has(c.permission));
  const results = await Promise.all(allowed.map(async (c) => ({ key: c.key, ...(await c.load(client, today)) })));
  return results.filter((r) => r.count > 0);
}
