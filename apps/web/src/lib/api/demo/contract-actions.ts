import {
  allocateRelease,
  billingFigures,
  billingProblem,
  changeOrderProblem,
  closeProblem,
  contractBill,
  contractFigures,
  contractInvoice,
  contractReminders,
  dec,
  draftProblem,
  featureOn,
  heldByLine,
  moneyString,
  nextNumber,
  sum,
  waiverProblem,
  type ChangeOrder,
  type Contract,
  type ContractBilling,
  type ContractLine,
  type InsuranceCertificate,
  type LienWaiver,
} from "@workspace/shared";
import type {
  BillingInput,
  CertificateInput,
  ChangeOrderInput,
  ContractInput,
  ReleaseInput,
  SignatureInput,
  WaiverInput,
} from "../contract";
import { DemoRuleError } from "./admin-rules";
import { inAppFor, money, notify, usersWith } from "./notification-actions";
import { describeFiles, invoiceWithLedger, storeFiles, type ActionContext } from "./payment-actions";
import { placeholderProof } from "./placeholder-proof";

function need(ctx: ActionContext, id: string): Contract {
  const contract = ctx.db.get("contracts", id);
  if (!contract) throw new DemoRuleError("This contract no longer exists.");
  return contract;
}

const linesOf = (ctx: ActionContext, id: string) => ctx.db.list("contractLines").filter((l) => l.contractId === id);
const billingsOf = (ctx: ActionContext, id: string) =>
  ctx.db.list("contractBillings").filter((b) => b.contractId === id);
const figuresOf = (ctx: ActionContext, c: Contract) =>
  contractFigures(c, ctx.db.list("contractLines"), ctx.db.list("contractBillings"), ctx.db.list("changeOrders"));

/** The company on the other side, as a message recipient. */
function party(ctx: ActionContext, c: Contract) {
  const found = c.customerId
    ? ctx.db.get("customers", c.customerId)
    : c.supplierId
      ? ctx.db.get("suppliers", c.supplierId)
      : undefined;
  return { id: found?.id ?? "", name: found?.name ?? "Unknown", email: found?.email ?? "" };
}

const log = (ctx: ActionContext, action: string, c: Contract, before: string | null, after: string | null) =>
  ctx.audit({ category: "data", action, target: `${c.number}, ${c.title}`, before, after });

/** Adds or edits a contract and its schedule; lines can change only while it is a draft (ADR 0026). */
export async function saveContract(ctx: ActionContext, input: ContractInput): Promise<Contract> {
  await ctx.assertCan([input.id ? "contracts.contract.edit" : "contracts.contract.create"]);
  const before = input.id ? need(ctx, input.id) : undefined;
  if (before && before.status !== "draft")
    throw new DemoRuleError("Only a draft can be edited. Use a change order instead.");
  if (!input.title.trim()) throw new DemoRuleError("Give the contract a title.");
  if (!input.customerId && !input.supplierId) throw new DemoRuleError("Choose the other company.");
  const id = before?.id ?? ctx.newId("ctr");
  const { lines, ...fields } = input;
  const value = input.kind === "master" ? dec(0) : sum(lines.map((l) => l.scheduledValue));
  const contract: Contract = {
    ...(before ?? {
      masterId: null,
      parentContractId: null,
      renewedFromId: null,
      sentAt: null,
      signedAt: null,
      signature: null,
      substantialCompletionAt: null,
      finalAcceptanceAt: null,
      terminatedAt: null,
      terminationReason: null,
      closeOverrideReason: null,
      files: [],
      status: "draft" as const,
      number: nextNumber(
        "CTR-",
        ctx.db.list("contracts").map((c) => c.number),
        1001,
      ),
    }),
    ...fields,
    id,
    originalValue: moneyString(value),
    retainagePct: input.kind === "master" ? "0" : input.retainagePct,
    storedRetainagePct: input.kind === "master" ? "0" : input.storedRetainagePct,
  };
  ctx.db.put("contracts", contract);
  for (const old of linesOf(ctx, id)) ctx.db.remove("contractLines", old.id);
  for (const line of input.kind === "master" ? [] : lines) {
    const saved: ContractLine = { ...line, id: ctx.newId("cln"), contractId: id, changeOrderId: null };
    ctx.db.put("contractLines", saved);
  }
  log(
    ctx,
    before ? "Edited contract" : "Added contract",
    contract,
    before?.originalValue ?? null,
    contract.originalValue,
  );
  return contract;
}

/** Sends a draft for signature; the lines lock and the other company is told (spec D2). */
export async function sendContract(ctx: ActionContext, id: string) {
  await ctx.assertCan(["contracts.contract.edit"]);
  const contract = need(ctx, id);
  if (contract.status !== "draft") throw new DemoRuleError("Only a draft can be sent for signature.");
  const problem = draftProblem(contract, ctx.db.list("contractLines"));
  if (problem) throw new DemoRuleError(problem);
  const saved = ctx.db.put("contracts", { ...contract, status: "sent", sentAt: ctx.now });
  const other = party(ctx, contract);
  notify(ctx, {
    key: "contract.signature",
    source: { type: "contract", id: contract.id, href: `/contracts/${contract.id}` },
    values: { "party.name": other.name, "contract.number": contract.number, "contract.title": contract.title },
    to: [{ kind: contract.customerId ? "customer" : "supplier", id: other.id, name: other.name, email: other.email }],
    version: ctx.now,
  });
  log(ctx, "Sent contract for signature", contract, "draft", "sent");
  return saved;
}

/** Takes a contract back to draft while it waits for signature. */
export async function recallContract(ctx: ActionContext, id: string) {
  await ctx.assertCan(["contracts.contract.edit"]);
  const contract = need(ctx, id);
  if (contract.status !== "sent") throw new DemoRuleError("Only a contract waiting for signature can be recalled.");
  log(ctx, "Recalled contract", contract, "sent", "draft");
  return ctx.db.put("contracts", { ...contract, status: "draft", sentAt: null });
}

/**
 * Records a simulated signature (spec D2, ADR 0026): typed name, date and an audit record with no IP
 * address, and a PDF filed on the contract. The screen labels it simulated.
 */
export async function signContract(ctx: ActionContext, id: string, input: SignatureInput) {
  await ctx.assertCan(["contracts.contract.approve"]);
  const contract = need(ctx, id);
  if (contract.status !== "sent") throw new DemoRuleError("Send the contract for signature first.");
  if (input.signerName.trim().length < 3) throw new DemoRuleError("Type the signer's full name.");
  const pdf = placeholderProof(
    [
      `${contract.number}, ${contract.title}`,
      `Signed by ${input.signerName.trim()}, ${input.signerRole.trim()}`,
      `Date: ${ctx.today}`,
    ],
    "Signed contract",
    "Simulated signature for the demo. Not a legal signature.",
  );
  const file = new File([pdf], `Signed ${contract.number}.pdf`, { type: "application/pdf" });
  const metas = await describeFiles(ctx, contract.id, [file], 0);
  await storeFiles(ctx, metas, [file]);
  const other = party(ctx, contract);
  const saved = ctx.db.put("contracts", {
    ...contract,
    status: "active",
    signedAt: ctx.now,
    files: [...contract.files, ...metas],
    signature: {
      documentId: contract.id,
      version: 1,
      hash: metas[0]!.id,
      signerName: input.signerName.trim(),
      signerEmail: other.email,
      signerRole: input.signerRole.trim(),
      consentVersion: "demo-1",
      recordedBy: ctx.actor.name,
      signedAt: ctx.now,
      events: [
        { kind: "sent", at: contract.sentAt ?? ctx.now },
        { kind: "signed", at: ctx.now },
      ],
    },
  });
  log(ctx, "Recorded simulated signature", contract, "sent", input.signerName.trim());
  return saved;
}

/** Marks substantial completion, which starts the retainage clock (ADR 0026). */
export async function completeContract(ctx: ActionContext, id: string) {
  await ctx.assertCan(["contracts.contract.edit"]);
  const contract = need(ctx, id);
  if (contract.status !== "active") throw new DemoRuleError("Only an active contract can be completed.");
  log(ctx, "Completed contract", contract, "active", "completed");
  return ctx.db.put("contracts", { ...contract, status: "completed", substantialCompletionAt: ctx.today });
}

/** Closes a contract once nothing is held or owed and a final waiver is on file; the Owner may override with a reason. */
export async function closeContract(ctx: ActionContext, id: string, overrideReason: string | null) {
  await ctx.assertCan(["contracts.contract.edit"]);
  const contract = need(ctx, id);
  if (contract.status !== "completed") throw new DemoRuleError("Only a completed contract can be closed.");
  const figures = figuresOf(ctx, contract);
  const balance = sum(
    billingsOf(ctx, id)
      .filter((b) => b.status === "posted" && b.invoiceId)
      .map((b) => invoiceWithLedger(ctx, b.invoiceId!).ledger.balance),
  );
  const hasFinalWaiver = ctx.db
    .list("lienWaivers")
    .some((w) => w.contractId === id && w.type.endsWith("final") && w.status === "received");
  const problem = closeProblem({ held: figures.held, balance: moneyString(balance), hasFinalWaiver });
  if (problem && !overrideReason?.trim()) throw new DemoRuleError(problem);
  if (problem) await ctx.assertCan(["contracts.contract.approve"]);
  log(
    ctx,
    "Closed contract",
    contract,
    "completed",
    overrideReason?.trim() ? `closed: ${overrideReason.trim()}` : "closed",
  );
  return ctx.db.put("contracts", {
    ...contract,
    status: "closed",
    finalAcceptanceAt: ctx.today,
    closeOverrideReason: overrideReason?.trim() || null,
  });
}

/** Ends a contract with a reason; billing stops and held retainage stays until released (spec D2). */
export async function terminateContract(ctx: ActionContext, id: string, reason: string) {
  await ctx.assertCan(["contracts.contract.approve"]);
  if (reason.trim().length < 3) throw new DemoRuleError("Give the reason for ending this contract.");
  const contract = need(ctx, id);
  if (contract.status !== "active" && contract.status !== "completed")
    throw new DemoRuleError("This contract can't be terminated.");
  log(ctx, "Terminated contract", contract, contract.status, reason.trim());
  return ctx.db.put("contracts", {
    ...contract,
    status: "terminated",
    terminatedAt: ctx.today,
    terminationReason: reason.trim(),
  });
}

/** Starts the next term as a new draft linked to this one (ADR 0026). */
export async function renewContract(ctx: ActionContext, id: string) {
  await ctx.assertCan(["contracts.contract.create"]);
  const contract = need(ctx, id);
  const copy = await saveContract(ctx, {
    ...contract,
    id: undefined,
    startsAt: contract.endsAt,
    endsAt: new Date(Date.parse(contract.endsAt) + (Date.parse(contract.endsAt) - Date.parse(contract.startsAt)))
      .toISOString()
      .slice(0, 10),
    lines: linesOf(ctx, id).map((l) => ({ ...l })),
  });
  return ctx.db.put("contracts", { ...copy, renewedFromId: contract.id });
}

const billable = (c: Contract) => c.status === "active" || c.status === "completed";

/** The next invoice number with the company's prefix. */
const nextInvoiceNumber = (ctx: ActionContext) =>
  nextNumber(
    ctx.db.settings.localization.documents.invoicePrefix,
    ctx.db.list("invoices").map((i) => i.number),
    1001,
  );

function fileBilling(
  ctx: ActionContext,
  contract: Contract,
  billing: ContractBilling,
  amounts: { lineId: string; gross: string; withheld: string; released: string }[],
): ContractBilling {
  if (contract.direction === "customer") {
    const customer = ctx.db.get("customers", contract.customerId!)!;
    const invoice = contractInvoice(
      contract,
      customer,
      linesOf(ctx, contract.id),
      amounts,
      ctx.db.settings.localization,
      {
        id: ctx.newId("inv"),
        number: nextInvoiceNumber(ctx),
        issuedAt: ctx.today,
        createdBy: ctx.actor.id,
        billingId: billing.id,
      },
    );
    ctx.db.put("invoices", invoice);
    notify(ctx, {
      key: "milestone.invoiced",
      source: { type: "invoice", id: invoice.id, href: `/sales/invoices/${invoice.id}` },
      values: {
        "party.name": customer.name,
        "invoice.number": invoice.number,
        "invoice.total": money(ctx, invoice.total),
        "contract.title": contract.title,
      },
      to: [{ kind: "customer", id: customer.id, name: customer.name, email: customer.email }],
    });
    return ctx.db.put("contractBillings", { ...billing, invoiceId: invoice.id });
  }
  const supplier = ctx.db.get("suppliers", contract.supplierId!)!;
  const bill = contractBill(
    contract,
    supplier,
    { gross: billing.gross, withheld: billing.withheld, released: billing.released },
    {
      id: ctx.newId("bill"),
      number: `${contract.number}-${billing.number}`,
      issuedAt: ctx.today,
      billingId: billing.id,
    },
  );
  ctx.db.put("bills", bill);
  return ctx.db.put("contractBillings", { ...billing, billId: bill.id });
}

/** Posts a pay application (spec D2, ADR 0026): one invoice or bill for the period, retainage held off its total. */
export async function postBilling(
  ctx: ActionContext,
  contractId: string,
  input: BillingInput,
): Promise<ContractBilling> {
  await ctx.assertCan(["contracts.billing.create"]);
  const contract = need(ctx, contractId);
  if (!billable(contract)) throw new DemoRuleError("Only an active or completed contract can be billed.");
  const lines = linesOf(ctx, contractId);
  const past = billingsOf(ctx, contractId);
  const problem = billingProblem(input.lines, lines, past);
  if (problem) throw new DemoRuleError(problem);
  const figures = billingFigures(input.lines, past);
  const billing: ContractBilling = {
    id: ctx.newId("cbl"),
    contractId,
    number: past.length + 1,
    kind: "progress",
    periodEnd: input.periodEnd,
    status: "posted",
    lines: input.lines,
    releases: [],
    gross: moneyString(figures.gross),
    withheld: moneyString(figures.withheld),
    released: "0.00",
    invoiceId: null,
    billId: null,
    postedAt: ctx.now,
    postedBy: ctx.actor.name,
  };
  ctx.db.put("contractBillings", billing);
  const amounts = figures.lines.map((l) => ({
    lineId: l.lineId,
    gross: moneyString(l.gross),
    withheld: moneyString(l.withheld),
    released: "0.00",
  }));
  log(
    ctx,
    "Posted contract billing",
    contract,
    null,
    `#${billing.number}, gross ${billing.gross}, held ${billing.withheld}`,
  );
  return fileBilling(ctx, contract, billing, amounts);
}

/** Releases held retainage, in part or in full, on its own invoice or bill (spec D2, ADR 0026). */
export async function releaseRetainage(
  ctx: ActionContext,
  contractId: string,
  input: ReleaseInput,
): Promise<ContractBilling> {
  await ctx.assertCan(["contracts.billing.create"]);
  const contract = need(ctx, contractId);
  const lines = linesOf(ctx, contractId);
  const past = billingsOf(ctx, contractId);
  const held = heldByLine(past, lines);
  const totalHeld = sum([...held.values()]);
  const amount = dec(input.amount || 0);
  if (amount.lte(0) || amount.gt(totalHeld)) throw new DemoRuleError("Enter an amount up to what is held.");
  const releases = allocateRelease(moneyString(amount), held);
  const billing: ContractBilling = {
    id: ctx.newId("cbl"),
    contractId,
    number: past.length + 1,
    kind: "release",
    periodEnd: ctx.today,
    status: "posted",
    lines: [],
    releases,
    gross: "0.00",
    withheld: "0.00",
    released: moneyString(amount),
    invoiceId: null,
    billId: null,
    postedAt: ctx.now,
    postedBy: ctx.actor.name,
  };
  ctx.db.put("contractBillings", billing);
  log(ctx, "Released retainage", contract, moneyString(totalHeld), `released ${billing.released}`);
  return fileBilling(
    ctx,
    contract,
    billing,
    releases.map((r) => ({ lineId: r.lineId, gross: "0.00", withheld: "0.00", released: r.amount })),
  );
}

/** Voids the latest billing while nothing on it is confirmed (ADR 0026). */
export async function voidBilling(ctx: ActionContext, billingId: string, reason: string) {
  await ctx.assertCan(["contracts.billing.void"]);
  if (reason.trim().length < 3) throw new DemoRuleError("Say why this billing is being voided.");
  const billing = ctx.db.get("contractBillings", billingId);
  if (!billing) throw new DemoRuleError("This billing no longer exists.");
  const latest = billingsOf(ctx, billing.contractId)
    .filter((b) => b.status === "posted")
    .sort((a, b) => b.number - a.number)[0];
  if (latest?.id !== billingId) throw new DemoRuleError("Only the latest billing can be voided.");
  if (billing.invoiceId) {
    const { invoice, ledger } = invoiceWithLedger(ctx, billing.invoiceId);
    if (dec(ledger.paid).gt(0)) throw new DemoRuleError("This billing has a confirmed payment, so it can't be voided.");
    ctx.db.put("invoices", { ...invoice, voidedAt: ctx.now, voidReason: reason.trim() });
  }
  if (billing.billId) {
    if (
      ctx.db
        .list("supplierPayments")
        .some((p) => p.status === "confirmed" && p.allocations.some((a) => a.billId === billing.billId))
    ) {
      throw new DemoRuleError("This billing has a confirmed payment, so it can't be voided.");
    }
    ctx.db.remove("bills", billing.billId);
  }
  const contract = need(ctx, billing.contractId);
  log(ctx, "Voided contract billing", contract, `#${billing.number}`, reason.trim());
  return ctx.db.put("contractBillings", { ...billing, status: "void" });
}

/** Saves a change order as a draft or sends it for approval (spec D2). */
export async function saveChangeOrder(
  ctx: ActionContext,
  contractId: string,
  input: ChangeOrderInput,
): Promise<ChangeOrder> {
  await ctx.assertCan(["contracts.change_order.create"]);
  const contract = need(ctx, contractId);
  if (!billable(contract)) throw new DemoRuleError("Only an active or completed contract takes change orders.");
  if (!input.reason.trim()) throw new DemoRuleError("Say what is changing and why.");
  if (
    input.lines.length === 0 ||
    input.lines.some((l) => !l.description.trim() || !/^-?\d+(\.\d{1,2})?$/.test(l.amountDelta))
  ) {
    throw new DemoRuleError("Each line needs a description and an amount.");
  }
  const count = ctx.db.list("changeOrders").filter((c) => c.contractId === contractId).length;
  const order: ChangeOrder = {
    id: ctx.newId("cor"),
    number: `CO-${count + 1}`,
    contractId,
    status: "pending",
    reason: input.reason.trim(),
    lines: input.lines,
    submittedAt: ctx.now,
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    files: [],
  };
  ctx.db.put("changeOrders", order);
  log(ctx, "Submitted change order", contract, null, `${order.number}: ${order.reason}`);
  return order;
}

/** Approves or rejects a change order. Approval raises the contract value at once; issued invoices never change (ADR 0026). */
export async function decideChangeOrder(
  ctx: ActionContext,
  id: string,
  decision: { approve: boolean; reason: string },
) {
  await ctx.assertCan(["contracts.change_order.approve"]);
  const order = ctx.db.get("changeOrders", id);
  if (!order) throw new DemoRuleError("This change order no longer exists.");
  if (order.status !== "pending") throw new DemoRuleError("This change order has already been decided.");
  const contract = need(ctx, order.contractId);
  if (!decision.approve && decision.reason.trim().length < 3) throw new DemoRuleError("Say why it is rejected.");
  if (decision.approve) {
    const problem = changeOrderProblem(order, linesOf(ctx, contract.id), billingsOf(ctx, contract.id));
    if (problem) throw new DemoRuleError(problem);
    const lines = linesOf(ctx, contract.id);
    order.lines.forEach((change, i) => {
      if (change.lineId) {
        const line = lines.find((l) => l.id === change.lineId)!;
        ctx.db.put("contractLines", {
          ...line,
          scheduledValue: moneyString(dec(line.scheduledValue).plus(change.amountDelta)),
        });
      } else {
        ctx.db.put("contractLines", {
          id: ctx.newId("cln"),
          contractId: contract.id,
          code: `${order.number}.${i + 1}`,
          description: change.description,
          category: change.category,
          billing: "percent",
          scheduledValue: moneyString(change.amountDelta),
          retainagePct: null,
          storedRetainagePct: null,
          milestoneDueAt: null,
          changeOrderId: order.id,
          estimatedCost: "0.00",
        });
      }
    });
  }
  log(
    ctx,
    decision.approve ? "Approved change order" : "Rejected change order",
    contract,
    order.number,
    decision.reason.trim() || null,
  );
  return ctx.db.put("changeOrders", {
    ...order,
    status: decision.approve ? "approved" : "rejected",
    decidedAt: ctx.now,
    decidedBy: ctx.actor.name,
    decisionReason: decision.reason.trim() || null,
  });
}

/** Records a lien waiver against a payment (spec D2, ADR 0026). */
export async function recordWaiver(ctx: ActionContext, contractId: string, input: WaiverInput): Promise<LienWaiver> {
  await ctx.assertCan(["contracts.compliance.manage"]);
  const contract = need(ctx, contractId);
  const paymentConfirmed =
    (!!input.paymentId && ctx.db.get("payments", input.paymentId)?.status === "confirmed") ||
    (!!input.supplierPaymentId && ctx.db.get("supplierPayments", input.supplierPaymentId)?.status === "confirmed");
  const problem = waiverProblem(input, paymentConfirmed);
  if (problem) throw new DemoRuleError(problem);
  const waiver: LienWaiver = {
    id: ctx.newId("lwv"),
    contractId,
    direction: contract.direction === "customer" ? "given" : "received",
    type: input.type,
    paymentId: input.paymentId,
    supplierPaymentId: input.supplierPaymentId,
    amount: moneyString(input.amount),
    throughDate: input.throughDate,
    state: contract.jobSite.state,
    statutoryForm: input.statutoryForm,
    signedOn: ctx.today,
    files: [],
    status: "received",
  };
  ctx.db.put("lienWaivers", waiver);
  log(ctx, "Recorded lien waiver", contract, null, `${input.type.replaceAll("_", " ")}, ${waiver.amount}`);
  return waiver;
}

/** Saves a subcontractor's certificate of insurance (spec D1). */
export async function saveCertificate(
  ctx: ActionContext,
  contractId: string,
  input: CertificateInput,
): Promise<InsuranceCertificate> {
  await ctx.assertCan(["contracts.compliance.manage"]);
  const contract = need(ctx, contractId);
  if (!contract.supplierId) throw new DemoRuleError("Insurance certificates belong on a subcontract.");
  if (input.coverages.length === 0 || input.coverages.some((c) => !c.expiresOn))
    throw new DemoRuleError("Each coverage needs an expiry date.");
  const existing = ctx.db.list("insuranceCertificates").find((c) => c.contractId === contractId);
  const saved = ctx.db.put("insuranceCertificates", {
    id: existing?.id ?? ctx.newId("coi"),
    supplierId: contract.supplierId,
    contractId,
    files: existing?.files ?? [],
    ...input,
  });
  log(ctx, "Saved insurance certificate", contract, null, input.producer);
  return saved;
}

/** Adds attachments to a contract (spec D2). */
export async function addContractFiles(ctx: ActionContext, contractId: string, files: readonly File[]) {
  await ctx.assertCan(["contracts.contract.edit"]);
  const contract = need(ctx, contractId);
  const metas = await describeFiles(ctx, contract.id, files, contract.files.length);
  await storeFiles(ctx, metas, files);
  ctx.db.put("contracts", { ...contract, files: [...contract.files, ...metas] });
  log(ctx, "Added contract files", contract, null, metas.map((m) => m.name).join(", "));
}

/** Raises contract reminders through the notification centre; each step fires once (spec D2, A4). */
export async function raiseContractReminders(ctx: ActionContext) {
  if (!featureOn("contracts.register")) return;
  const reminders = contractReminders(
    ctx.db.list("contracts"),
    ctx.db.list("contractLines"),
    ctx.db.list("insuranceCertificates"),
    ctx.today,
  );
  if (reminders.length === 0) return;
  const approvers = await usersWith(ctx, "contracts.contract.approve");
  for (const r of reminders) {
    const contract = ctx.db.get("contracts", r.contractId);
    if (!contract) continue;
    notify(ctx, {
      key: "contract.expiring",
      source: { type: "contract", id: r.key, href: `/contracts/${contract.id}` },
      values: {
        "contract.number": contract.number,
        "contract.title": contract.title,
        "reminder.what": r.what,
        "reminder.date": r.date,
      },
      to: approvers.map((u) => ({ kind: "user" as const, id: u.id, name: u.name, email: u.email })),
      inApp: inAppFor(approvers, `${contract.number}: ${r.what} on ${r.date}`),
    });
  }
}
