import {
  detectProofType,
  duplicateReference,
  invoiceLedger,
  MAX_PROOF_FILES,
  moneyString,
  needsApproval,
  nextPaymentNumber,
  proofFilesProblem,
  validatePayment,
  type FileMeta,
  type Invoice,
  type InvoiceLedger,
  type Payment,
  type PermissionKey,
  type RecordPaymentInput,
  type User,
} from "@workspace/shared";
import type { AuditInput, PaymentDecision } from "../contract";
import { DemoRuleError } from "./admin-rules";
import { notifyPaymentReceipt, notifyPaymentToVerify } from "./notification-actions";
import type { CompanyDb } from "./company-db";
import type { FileStore } from "./file-store";
import { placeholderProof } from "./placeholder-proof";

/** What a payment action needs from the store: the company, who acts, and the store's own checks. */
export interface ActionContext {
  db: CompanyDb;
  today: string;
  now: string;
  actor: User;
  files: FileStore;
  can: (key: PermissionKey) => Promise<boolean>;
  assertCan: (anyOf: readonly PermissionKey[]) => Promise<void>;
  /** Writes an audit entry, under Payments unless a category is given. */
  audit: (entry: Omit<AuditInput, "category"> & Partial<Pick<AuditInput, "category">>) => void;
  newId: (kind: string) => string;
}

const dollars = (amount: string) => `$${moneyString(amount)}`;

/** The invoice and its ledger now, or a rule error when it is gone. */
export function invoiceWithLedger(ctx: ActionContext, invoiceId: string): { invoice: Invoice; ledger: InvoiceLedger } {
  const invoice = ctx.db.get("invoices", invoiceId);
  if (!invoice) throw new DemoRuleError("This invoice no longer exists.");
  const docs = { payments: ctx.db.list("payments"), adjustments: ctx.db.list("invoiceAdjustments") };
  return { invoice, ledger: invoiceLedger(invoice, docs, ctx.today) };
}

/**
 * Checks proof files by their real type and size (spec Appendix A "Files and storage") and
 * describes them for the record; nothing is stored yet.
 */
export async function describeFiles(ctx: ActionContext, ownerId: string, files: readonly File[], already = 0) {
  const heads = await Promise.all(files.map(async (f) => new Uint8Array(await f.slice(0, 16).arrayBuffer())));
  const problem = proofFilesProblem(files.map((f, i) => ({ name: f.name, size: f.size, head: heads[i]! })));
  if (problem) throw new DemoRuleError(problem);
  if (already + files.length > MAX_PROOF_FILES) {
    throw new DemoRuleError(`A payment keeps at most ${MAX_PROOF_FILES} files.`);
  }
  return files.map((f, i): FileMeta => ({
    id: `${ownerId}-file-${already + i + 1}-${crypto.randomUUID().slice(0, 4)}`,
    name: f.name,
    type: detectProofType(heads[i]!)!,
    size: f.size,
    uploadedBy: ctx.actor.name,
    uploadedAt: ctx.now,
  }));
}

/** Stores the files, or none of them: a failure removes what was already written (no orphan files). */
export async function storeFiles(ctx: ActionContext, metas: readonly FileMeta[], files: readonly File[]) {
  const written: string[] = [];
  try {
    for (const [i, meta] of metas.entries()) {
      await ctx.files.put(meta.id, files[i]!);
      written.push(meta.id);
    }
  } catch (error) {
    await ctx.files.remove(written).catch(() => undefined);
    throw error;
  }
}

/**
 * Records a customer payment (spec Appendix A "Record payment"): validated again here, proof
 * required, a duplicate reference only after the person confirmed it, the extra above the balance
 * only as credit and with permission. With approval on it waits for a second person.
 */
export async function recordPayment(ctx: ActionContext, input: RecordPaymentInput, files: readonly File[]) {
  await ctx.assertCan(["sales.payment.record"]);
  const { invoice, ledger } = invoiceWithLedger(ctx, input.invoiceId);
  if (ledger.state === "void" || ledger.state === "return" || ledger.balance === "0.00") {
    throw new DemoRuleError(`Invoice ${invoice.number} has nothing left to pay.`);
  }
  const canCredit = await ctx.can("sales.payment.apply_credit");
  const errors = validatePayment(input, {
    issuedAt: invoice.issuedAt,
    today: ctx.today,
    balance: ledger.balance,
    canCredit,
    formatMoney: dollars,
  });
  const first = Object.values(errors)[0];
  if (first) throw new DemoRuleError(first);
  const payments = ctx.db.list("payments");
  const duplicate = input.method === "cash" ? undefined : duplicateReference(input.reference, payments);
  if (duplicate && !input.allowDuplicateReference) {
    throw new DemoRuleError(`Payment ${duplicate.number} already uses reference ${input.reference.trim()}.`);
  }
  const id = ctx.newId("pay");
  const metas = await describeFiles(ctx, id, files);
  await storeFiles(ctx, metas, files);
  const settings = ctx.db.settings.payments;
  const payment: Payment = {
    id,
    number: nextPaymentNumber(
      settings.paymentPrefix,
      payments.map((p) => p.number),
    ),
    invoiceId: invoice.id,
    customerId: invoice.customerId,
    kind: input.kind,
    amount: moneyString(input.amount),
    date: input.date,
    method: input.method,
    checkNumber: input.method === "check" ? input.checkNumber.trim() : "",
    cardLast4: input.method === "card" ? input.cardLast4.trim() : "",
    reference: input.reference.trim(),
    note: input.note.trim(),
    files: metas,
    status: needsApproval(settings, input.amount) || recordedByOwnScopeRole(ctx) ? "pending" : "confirmed",
    recordedById: ctx.actor.id,
    recordedBy: ctx.actor.name,
    recordedAt: ctx.now,
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
  };
  ctx.db.put("payments", payment);
  ctx.audit({
    action: payment.kind === "deposit" ? "Recorded deposit" : "Recorded payment",
    target: `${payment.number} on ${invoice.number}`,
    before: `balance ${dollars(ledger.balance)}`,
    after: `${dollars(payment.amount)} by ${payment.method}${payment.reference ? ` ${payment.reference}` : ""}, ${
      payment.status === "pending" ? "pending verification" : "confirmed"
    }, ${metas.length} ${metas.length === 1 ? "file" : "files"}`,
  });
  if (payment.status === "pending") {
    await notifyPaymentToVerify(ctx, invoice.number, payment.amount, `/sales/invoices/${invoice.id}`);
  } else {
    notifyPaymentReceipt(ctx, payment, invoice, invoiceWithLedger(ctx, invoice.id).ledger.balance);
  }
  return payment;
}

/**
 * Whether the person records only their own sales (plan N-1): what Sales records always waits for
 * a second person, whatever the amount and whatever the company's approval setting.
 */
function recordedByOwnScopeRole(ctx: ActionContext): boolean {
  const roles = ctx.db.list("roles").filter((r) => ctx.actor.roleIds.includes(r.id));
  return roles.length > 0 && roles.every((r) => r.dataScope === "own");
}

/**
 * Confirms or rejects a payment waiting for verification (spec Appendix A "Approval"): only
 * someone with approval permission who did not record it; a rejection needs a reason.
 */
export async function reviewPayment(ctx: ActionContext, paymentId: string, decision: PaymentDecision) {
  await ctx.assertCan(["sales.payment.approve"]);
  const payment = ctx.db.get("payments", paymentId);
  if (!payment) throw new DemoRuleError("This payment no longer exists.");
  if (payment.status !== "pending")
    throw new DemoRuleError(`Payment ${payment.number} is not waiting for verification.`);
  if (payment.recordedById === ctx.actor.id) {
    throw new DemoRuleError("Someone other than the person who recorded a payment must verify it.");
  }
  const reason = decision.action === "reject" ? decision.reason.trim() : "";
  if (decision.action === "reject" && reason.length < 3) throw new DemoRuleError("Say why the payment is rejected.");
  const { invoice } = invoiceWithLedger(ctx, payment.invoiceId);
  const reviewed: Payment = {
    ...payment,
    status: decision.action === "confirm" ? "confirmed" : "rejected",
    reviewedBy: ctx.actor.name,
    reviewedAt: ctx.now,
    rejectReason: reason || null,
  };
  ctx.db.put("payments", reviewed);
  ctx.audit({
    action: decision.action === "confirm" ? "Confirmed payment" : "Rejected payment",
    target: `${payment.number} on ${invoice.number}`,
    before: `${dollars(payment.amount)}, pending verification`,
    after: decision.action === "confirm" ? "confirmed" : `rejected: ${reason}`,
  });
  if (decision.action === "confirm") {
    notifyPaymentReceipt(ctx, reviewed, invoice, invoiceWithLedger(ctx, invoice.id).ledger.balance);
  }
  return reviewed;
}

/**
 * Adds proof files to a payment (spec Appendix A: after confirmation only attachments and a note
 * can be added). A voided or rejected payment stays as it was.
 */
export async function attachPaymentFiles(ctx: ActionContext, paymentId: string, files: readonly File[]) {
  await ctx.assertCan(["sales.payment.record"]);
  const payment = ctx.db.get("payments", paymentId);
  if (!payment) throw new DemoRuleError("This payment no longer exists.");
  if (payment.status === "voided" || payment.status === "rejected") {
    throw new DemoRuleError(`Payment ${payment.number} is ${payment.status}; files can't be added.`);
  }
  const metas = await describeFiles(ctx, payment.id, files, payment.files.length);
  await storeFiles(ctx, metas, files);
  const saved = { ...payment, files: [...payment.files, ...metas] };
  ctx.db.put("payments", saved);
  ctx.audit({
    action: "Attached file to payment",
    target: payment.number,
    before: `${payment.files.length} files`,
    after: metas.map((m) => m.name).join(", "),
  });
  return saved;
}

/**
 * A stored file by id. Seeded payments have no bytes in this browser, so their proof is a
 * generated placeholder PDF built from the payment (Batch H: generated placeholder proofs).
 */
export async function readFile(ctx: ActionContext, fileId: string): Promise<Blob> {
  const stored = await ctx.files.get(fileId);
  if (stored) return stored;
  const holder = ctx.db.list("employees").find((e) => e.documents.some((d) => d.id === fileId));
  if (holder) {
    const name = holder.documents.find((d) => d.id === fileId)!.name;
    return placeholderProof([`${name} for ${holder.name}`], "Sample employee document", "Generated for the demo.");
  }
  const expense = ctx.db.list("expenses").find((e) => e.files.some((f) => f.id === fileId));
  if (expense)
    return placeholderProof(
      [`${expense.number}, ${expense.date}`, `Amount: ${dollars(expense.amount)}`],
      "Sample receipt",
      "Generated for the demo. Not a real receipt.",
    );
  const contract = ctx.db.list("contracts").find((c) => c.files.some((f) => f.id === fileId));
  if (contract) {
    return placeholderProof(
      [`${contract.number}, ${contract.title}`, `Signed ${contract.signedAt?.slice(0, 10) ?? ""}`],
      "Signed contract",
      "Simulated signature for the demo. Not a legal signature.",
    );
  }
  const payment = ctx.db.list("payments").find((p) => p.files.some((f) => f.id === fileId));
  if (!payment) throw new DemoRuleError("This file is not in this browser any more.");
  const invoice = ctx.db.get("invoices", payment.invoiceId);
  const customer = ctx.db.get("customers", payment.customerId);
  return placeholderProof([
    `Payment ${payment.number} for invoice ${invoice?.number ?? ""}`,
    `Customer: ${customer?.name ?? ""}`,
    `Amount: ${dollars(payment.amount)} on ${payment.date}`,
    `Method: ${payment.method}${payment.reference ? `, reference ${payment.reference}` : ""}`,
  ]);
}
