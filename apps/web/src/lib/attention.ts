import {
  featureOn,
  type FeatureKey,
  daysBetween,
  INVOICE_STATUS_LABELS,
  invoiceStatus,
  type Access,
  type PermissionKey,
  type ProductKey,
  filteredHref,
  plural,
} from "@workspace/shared";
import type { ApiClient } from "./api/contract";
import { loadSalesLedger } from "./sales-ledger";

/** Rolls shorter than this are flagged so the warehouse can reorder (spec "Dashboard"). */
export const LOW_ROLL_FT = 20;
/** Jobs signed off within this many days, with a balance, are flagged for collection (spec B6). */
const COMPLETED_JOB_DAYS = 7;
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
  /** The feature whose screen handles the item; the check runs only while it is switched on. */
  feature: FeatureKey;
  permission: PermissionKey;
  products: ProductKey[];
  load: (client: ApiClient, today: string) => Promise<Omit<AttentionItem, "key">>;
}

/**
 * The "Needs attention" checks (spec "Dashboard": overdue invoices, low rolls, expiring
 * certificates, today's jobs; Appendix A: payments to verify) plus HR approvals. Each runs only
 * for people allowed to act on it. Nothing is stored: an item is gone once it is handled.
 */
const CHECKS: Check[] = [
  {
    key: "overdue",
    feature: "sales.invoices",
    permission: "sales.invoice.view",
    products: ["flooring"],
    load: async (client) => {
      // Counted by leading status, so the count matches the list the link opens.
      const { ledgers } = await loadSalesLedger(client);
      const count = [...ledgers.values()].filter((l) => invoiceStatus(l).main === "overdue").length;
      return {
        count,
        label: plural(count, "overdue invoice", "overdue invoices"),
        href: filteredHref("/sales?view=invoices", "sales-invoices", "state", [INVOICE_STATUS_LABELS.overdue]),
        tone: "danger",
      };
    },
  },
  {
    key: "completed-jobs",
    feature: "installation.calendar",
    permission: "sales.payment.record",
    products: ["flooring"],
    load: async (client, today) => {
      // Jobs signed off this week whose invoice still has a balance: time to collect (spec B6).
      const [jobs, { ledgers }] = await Promise.all([client.list("jobs"), loadSalesLedger(client)]);
      const due = jobs.filter(
        (j) =>
          j.signedOffAt &&
          j.invoiceId &&
          daysBetween(j.signedOffAt.slice(0, 10), today) <= COMPLETED_JOB_DAYS &&
          Number(ledgers.get(j.invoiceId)?.balance ?? "0") > 0,
      );
      const [first] = due;
      return {
        count: due.length,
        label:
          due.length === 1 && first
            ? `job completed with a balance due (${first.number})`
            : "jobs completed with a balance due",
        href:
          due.length === 1 && first
            ? `/sales/invoices/${first.invoiceId}`
            : filteredHref("/sales?view=invoices", "sales-invoices", "state", [INVOICE_STATUS_LABELS.open]),
        tone: "brand",
      };
    },
  },
  {
    key: "approve-adjustments",
    feature: "inventory.adjustments",
    permission: "inventory.stock.approve",
    products: ["flooring"],
    load: async (client) => {
      const count = (await client.list("stockAdjustments")).filter((a) => a.status === "pending").length;
      return {
        count,
        label: plural(count, "stock adjustment to approve", "stock adjustments to approve"),
        href: "/inventory?view=adjustments",
        tone: "warning",
      };
    },
  },
  {
    key: "verify-payments",
    feature: "finance.payments-queue",
    permission: "sales.payment.approve",
    products: ["flooring"],
    load: async (client) => {
      // Only what this person may confirm: nobody verifies a payment they recorded themselves (U-16).
      const me = await client.whoAmI();
      const count =
        (await client.list("payments")).filter((p) => p.status === "pending" && p.recordedById !== me).length +
        (await client.list("supplierPayments")).filter((p) => p.status === "pending" && p.recordedById !== me).length;
      return {
        count,
        label: plural(count, "payment to verify", "payments to verify"),
        href: "/finance?view=payments",
        tone: "warning",
      };
    },
  },
  {
    key: "low-rolls",
    feature: "inventory.rolls",
    permission: "inventory.roll.view",
    products: ["flooring"],
    load: async (client) => {
      const count = (await client.list("rolls")).filter(
        (r) => !r.isRemnant && Number(r.remainingLengthFt) > 0 && Number(r.remainingLengthFt) < LOW_ROLL_FT,
      ).length;
      return {
        count,
        label: `${plural(count, "roll", "rolls")} under ${LOW_ROLL_FT} ft`,
        href: filteredHref("/inventory?view=rolls", "inventory-rolls", "type", ["Low"]),
        tone: "warning",
      };
    },
  },
  {
    key: "certificates",
    feature: "sales.customers",
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
        href: filteredHref("/sales?view=customers", "sales-customers", "certificate", ["Expires soon"]),
        tone: "warning",
      };
    },
  },
  {
    key: "jobs-today",
    feature: "installation.calendar",
    permission: "installation.job.view",
    products: ["flooring"],
    load: async (client, today) => {
      const count = (await client.list("jobs")).filter((j) => j.date === today).length;
      return { count, label: `${plural(count, "job", "jobs")} today`, href: "/installation", tone: "brand" };
    },
  },
  {
    key: "pto",
    feature: "hr.time-off",
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
    key: "timesheets",
    feature: "hr.timesheets",
    permission: "hr.timesheet.approve",
    products: ["flooring", "hr"],
    load: async (client) => {
      const count = (await client.list("timesheets")).filter((t) => t.status === "submitted").length;
      return {
        count,
        label: `${plural(count, "timesheet", "timesheets")} to approve`,
        href: "/hr/timesheets?view=queue",
        tone: "warning",
      };
    },
  },
];

/** Attention items for the viewer, skipping checks they cannot act on and checks with nothing to show. */
export async function loadAttention(client: ApiClient, access: Access, product: ProductKey): Promise<AttentionItem[]> {
  const today = client.today();
  const allowed = CHECKS.filter(
    (c) => featureOn(c.feature) && c.products.includes(product) && access.permissions.has(c.permission),
  );
  const results = await Promise.all(allowed.map(async (c) => ({ key: c.key, ...(await c.load(client, today)) })));
  return results.filter((r) => r.count > 0);
}
