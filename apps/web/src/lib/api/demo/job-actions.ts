import {
  invoiceAfterInstallation,
  invoiceFromJob,
  invoiceLedger,
  linesFromJob,
  moneyString,
  nextNumber,
  type Job,
} from "@workspace/shared";
import { DemoRuleError } from "./admin-rules";
import type { ActionContext } from "./payment-actions";

/**
 * Records the customer's sign-off (spec B6): the job is complete, and its invoice moves forward:
 * Installed on the timeline, a held balance becomes due from today under the customer's terms, and
 * an invoice not yet sent is marked sent. Payment recorders see it in Needs attention.
 */
export async function signOffJob(ctx: ActionContext, jobId: string, signer: string): Promise<Job> {
  await ctx.assertCan(["installation.job.sign_off"]);
  const job = ctx.db.get("jobs", jobId);
  if (!job) throw new DemoRuleError("This job no longer exists.");
  if (job.status === "signed_off") throw new DemoRuleError(`${job.number} is already signed off.`);
  if (job.status === "scheduled") throw new DemoRuleError(`${job.number} has not started yet.`);
  const name = signer.trim();
  if (!name) throw new DemoRuleError("Enter the name the customer signs with.");
  const signed: Job = { ...job, status: "signed_off", signedBy: name, signedOffAt: `${ctx.today}T16:30` };
  ctx.db.put("jobs", signed);
  const invoice = job.invoiceId ? ctx.db.get("invoices", job.invoiceId) : undefined;
  let after = `signed off by ${name}`;
  if (invoice && !invoice.voidedAt) {
    const terms = ctx.db.get("customers", invoice.customerId)?.terms ?? "due_on_receipt";
    const moved = invoiceAfterInstallation(invoice, ctx.today, terms, ctx.actor.id);
    ctx.db.put("invoices", moved);
    const ledger = invoiceLedger(
      moved,
      { payments: ctx.db.list("payments"), adjustments: ctx.db.list("invoiceAdjustments") },
      ctx.today,
    );
    after += `; ${invoice.number} $${moneyString(ledger.balance)} balance due ${moved.dueAt}`;
  }
  ctx.audit({ category: "data", action: "Recorded sign-off", target: job.number, before: job.status, after });
  return signed;
}

/**
 * Creates the invoice for a job that has none (spec B6), prefilled from its materials and labor
 * and linked to the job. Needs sales.invoice.create. Audited.
 */
export async function createInvoiceFromJob(ctx: ActionContext, jobId: string) {
  await ctx.assertCan(["sales.invoice.create"]);
  const job = ctx.db.get("jobs", jobId);
  if (!job) throw new DemoRuleError("This job no longer exists.");
  if (job.invoiceId) throw new DemoRuleError(`${job.number} already has an invoice.`);
  const customer = ctx.db.get("customers", job.customerId);
  if (!customer) throw new DemoRuleError("The job's customer no longer exists.");
  const rep = ctx.db.get("users", customer.salesRepId) ?? ctx.actor;
  const locations = ctx.db.list("locations").filter((l) => l.kind === "warehouse");
  const location =
    locations.find((l) => l.branchId === rep.branchId) ?? locations.find((l) => l.isDefault) ?? locations[0];
  const lines = linesFromJob(job, ctx.db.list("products"), () => ctx.newId("ln"));
  const invoice = invoiceFromJob(job, customer, lines, ctx.db.settings.localization, {
    id: ctx.newId("inv"),
    number: nextNumber(
      ctx.db.settings.localization.documents.invoicePrefix,
      ctx.db.list("invoices").map((i) => i.number),
      1001,
    ),
    issuedAt: ctx.today,
    createdBy: ctx.actor.id,
    branchId: rep.branchId,
    locationId: location?.id ?? "",
  });
  ctx.db.put("invoices", invoice);
  ctx.db.put("jobs", { ...job, invoiceId: invoice.id });
  ctx.audit({
    category: "data",
    action: "Created invoice from job",
    target: job.number,
    before: null,
    after: `${invoice.number}, total $${invoice.total}`,
  });
  return invoice;
}
