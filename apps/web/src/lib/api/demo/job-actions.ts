import {
  invoiceAfterInstallation,
  invoiceFromJob,
  invoiceLedger,
  jobFromInvoice,
  linesFromJob,
  moneyString,
  nextNumber,
  type Job,
} from "@workspace/shared";
import type { ScheduleJobInput } from "../contract";
import { DemoRuleError } from "./admin-rules";
import { reserveFor } from "./inventory-actions";
import type { ActionContext } from "./payment-actions";

/**
 * Schedules the installation of an invoice that has no job yet (feature batch 2, H flow 1): one
 * crew, a day from today on and a start hour; the job is costed from the invoice. Audited.
 */
export async function scheduleJob(ctx: ActionContext, input: ScheduleJobInput): Promise<Job> {
  await ctx.assertCan(["installation.job.create"]);
  const invoice = ctx.db.get("invoices", input.invoiceId);
  if (!invoice || invoice.voidedAt || invoice.isReturn) {
    throw new DemoRuleError("Only an open sale can get an installation job.");
  }
  const jobs = ctx.db.list("jobs");
  const existing = jobs.find((j) => j.invoiceId === invoice.id);
  if (existing) throw new DemoRuleError(`${invoice.number} already has job ${existing.number}.`);
  const crew = ctx.db.get("crews", input.crewId);
  if (!crew) throw new DemoRuleError("Choose a crew.");
  if (input.date < ctx.today) throw new DemoRuleError("Choose today or a later day.");
  if (!Number.isInteger(input.startHour) || input.startHour < 6 || input.startHour > 17) {
    throw new DemoRuleError("Start between 6 AM and 5 PM.");
  }
  const job = jobFromInvoice(invoice, crew, {
    id: ctx.newId("job"),
    number: nextNumber(
      "J-",
      jobs.map((j) => j.number),
      4001,
    ),
    date: input.date,
    startHour: input.startHour,
  });
  ctx.db.put("jobs", job);
  ctx.audit({
    category: "data",
    action: "Scheduled installation",
    target: job.number,
    before: null,
    after: `${invoice.number}, ${crew.name}, ${input.date}`,
  });
  return job;
}

/** Starts a scheduled job on or after its day, so the crew can finish and the customer sign off. Audited. */
export async function startJob(ctx: ActionContext, jobId: string): Promise<Job> {
  await ctx.assertCan(["installation.job.edit"]);
  const job = ctx.db.get("jobs", jobId);
  if (!job) throw new DemoRuleError("This job no longer exists.");
  if (job.status !== "scheduled") throw new DemoRuleError(`${job.number} has already started.`);
  if (job.date > ctx.today) throw new DemoRuleError(`${job.number} is planned for a later day.`);
  const started: Job = { ...job, status: "in_progress" };
  ctx.db.put("jobs", started);
  ctx.audit({ category: "data", action: "Started job", target: job.number, before: "scheduled", after: "in progress" });
  return started;
}

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
  reserveFor(ctx, invoice);
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
