import { addDays } from "../../src/dates";
import { timeOffBalance } from "../../src/hr/time-off";
import { dec, moneyString } from "../../src/money";
import { notificationEvent } from "../../src/notifications/events";
import { renderTemplate } from "../../src/notifications/render";
import { billLedgerIndex } from "../../src/operations/purchasing";
import { nextNumber } from "../../src/operations/quotes";
import type {
  CompanyFixtures,
  NotificationEventKey,
  OutboxMessage,
  PtoRequest,
  SupplierPayment,
  TimeOffEntry,
} from "../../src/types";
import type { GenContext } from "./context";
import { policyIdFor } from "./hr-records";
import { Rng } from "./random";

/** Credit used at most this share of a supplier's limit once the old bills are paid. */
const CREDIT_CEILING = "0.8";
/** Overdue is kept to about this share of open payables, so the demo does not look like a failing business. */
const OVERDUE_SHARE = "0.2";

/**
 * Pays down old supplier bills (audit U-28): most overdue bills and anything over the credit
 * ceiling get a confirmed payment. Bills from contracts and expenses are left as they are.
 */
function withHealthyPayables(ctx: GenContext, rng: Rng, f: CompanyFixtures): CompanyFixtures {
  const ledgers = billLedgerIndex(f.bills, f.supplierPayments, ctx.anchor);
  const payments = [...f.supplierPayments];
  const by = f.users[0]!;
  const pay = (bill: CompanyFixtures["bills"][number], amount: string, date: string) => {
    const id = ctx.id("spay");
    const record: SupplierPayment = {
      id,
      number: nextNumber(
        "SP-",
        payments.map((p) => p.number),
        1,
      ),
      supplierId: bill.supplierId,
      date,
      method: rng.pick(["ach", "check"] as const),
      reference: `ACH-${rng.int(100000, 999999)}`,
      note: "",
      files: [
        {
          id: `${id}-remit`,
          name: "Remittance.pdf",
          type: "application/pdf",
          size: 36100,
          uploadedBy: by.name,
          uploadedAt: `${date}T15:00`,
        },
      ],
      allocations: [{ billId: bill.id, amount }],
      amount,
      status: "confirmed",
      recordedById: by.id,
      recordedBy: by.name,
      recordedAt: `${date}T15:00`,
      reviewedBy: null,
      reviewedAt: null,
      rejectReason: null,
      voidedBy: null,
      voidedAt: null,
      voidReason: null,
    };
    payments.push(record);
  };
  const balanceOf = (bill: CompanyFixtures["bills"][number]) => dec(ledgers.get(bill.id)?.balance ?? 0);
  const open = f.bills.filter((b) => b.poId !== null && balanceOf(b).gt(0));
  const settled = new Set<string>();
  const settle = (bill: CompanyFixtures["bills"][number]) => {
    settled.add(bill.id);
    const date = [addDays(bill.dueAt, -rng.int(0, 3)), addDays(ctx.anchor, -1)].sort()[0]!;
    pay(bill, ledgers.get(bill.id)!.balance, date < bill.issuedAt ? bill.issuedAt : date);
  };
  const total = (bills: typeof open) => bills.reduce((t, b) => t.plus(balanceOf(b)), dec(0));
  const unsettled = () => open.filter((b) => !settled.has(b.id));
  const overdueNow = () => unsettled().filter((b) => b.dueAt < ctx.anchor);
  for (const supplier of f.suppliers.filter((s) => dec(s.creditLimit).gt(0))) {
    const ceiling = dec(supplier.creditLimit).times(CREDIT_CEILING);
    for (const bill of unsettled()
      .filter((b) => b.supplierId === supplier.id)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt))) {
      if (total(unsettled().filter((b) => b.supplierId === supplier.id)).lte(ceiling)) break;
      settle(bill);
    }
  }
  // The largest overdue bills are paid first, until overdue is a fair share of what is open.
  for (const bill of [...overdueNow()].sort((a, b) => balanceOf(b).comparedTo(balanceOf(a)))) {
    if (total(overdueNow()).lte(total(unsettled()).times(OVERDUE_SHARE))) break;
    settle(bill);
  }
  return { ...f, supplierPayments: payments };
}

/** Everyone W-2 has some time off on the books, a third of it waiting for a decision (spec G1). */
function withTimeOffForAll(ctx: GenContext, rng: Rng, f: CompanyFixtures): CompanyFixtures {
  const asked = new Set(f.ptoRequests.map((r) => r.employeeId));
  const requests: PtoRequest[] = [...f.ptoRequests];
  const entries: TimeOffEntry[] = [...f.timeOffEntries];
  const prefix = ctx.company.idPrefix;
  const policyId = policyIdFor(prefix, "personal");
  f.employees
    .filter((e) => e.workerType === "w2" && e.status === "active" && !asked.has(e.id))
    .forEach((e, i) => {
      const pending = i % 3 === 0 || timeOffBalance(entries, e.id, policyId).lt(8);
      const start = addDays(ctx.anchor, pending ? rng.int(4, 30) : -rng.int(6, 40));
      const id = ctx.id("pto");
      requests.push({
        id,
        employeeId: e.id,
        policyId,
        start,
        end: start,
        hours: "8",
        kind: "personal",
        status: pending ? "pending" : "approved",
        note: "",
        decidedBy: pending ? null : f.users[0]!.name,
        decidedAt: pending ? null : `${addDays(start, -3)}T11:00`,
        decisionReason: null,
      });
      if (!pending)
        entries.push({
          id: ctx.id("tof"),
          employeeId: e.id,
          policyId,
          date: start,
          kind: "used",
          hours: "-8",
          note: "Time off taken",
          requestId: id,
          payPeriodId: null,
        });
    });
  return { ...f, ptoRequests: requests, timeOffEntries: entries };
}

/** A little Outbox history, so the page reads as lived-in (spec G1). All marked sent; nothing is really sent. */
function withOutboxHistory(ctx: GenContext, f: CompanyFixtures): CompanyFixtures {
  if (f.invoices.length === 0) return f;
  const owner = f.users[0]!;
  const row = (
    key: NotificationEventKey,
    sourceType: string,
    sourceId: string,
    href: string,
    at: string,
    customerId: string,
    values: Record<string, string>,
    attachment: string,
  ): OutboxMessage => {
    const event = notificationEvent(key);
    const customer = f.customers.find((c) => c.id === customerId)!;
    const filled = { "company.name": f.settings.branding.displayName, "customer.name": customer.name, ...values };
    return {
      id: ctx.id("out"),
      eventKey: key,
      sourceType,
      sourceId,
      actorUserId: owner.id,
      recipient: { kind: "customer", id: customer.id, name: customer.name, email: customer.email },
      fromName: f.settings.email.senderName,
      replyTo: f.settings.email.replyTo,
      subject: renderTemplate(event.subject, filled).text,
      bodyText: renderTemplate(event.body, filled).text,
      values: filled,
      attachments: [{ kind: "pdf", fileName: attachment, href }],
      status: "sent",
      failureType: null,
      failureDetail: null,
      createdAt: `${at}T10:00`,
      scheduledFor: null,
      sentAt: `${at}T10:00`,
      restricted: false,
      dedupeKey: `${key}|${sourceId}|seed`,
    };
  };
  const money = (v: string) => `$${moneyString(v)}`;
  const quotes = f.quotes
    .filter((q) => q.sentAt)
    .sort((a, b) => b.sentAt!.localeCompare(a.sentAt!))
    .slice(0, 3);
  const invoices = f.invoices
    .filter((i) => i.sentAt && !i.isReturn)
    .sort((a, b) => b.sentAt!.localeCompare(a.sentAt!))
    .slice(0, 3);
  const rows = [
    ...quotes.map((q) =>
      row(
        "quote.sent",
        "quote",
        q.id,
        `/sales/quotes/${q.id}`,
        q.sentAt!.slice(0, 10),
        q.customerId,
        { "quote.number": q.number, "quote.total": money(q.total), "quote.expires": q.expiresAt ?? "" },
        `${q.number}.pdf`,
      ),
    ),
    ...invoices.map((i) =>
      row(
        "invoice.sent",
        "invoice",
        i.id,
        `/sales/invoices/${i.id}`,
        i.sentAt!.slice(0, 10),
        i.customerId,
        { "invoice.number": i.number, "invoice.total": money(i.total), "invoice.due": i.dueAt ?? "" },
        `${i.number}.pdf`,
      ),
    ),
  ];
  return { ...f, outboxMessages: [...f.outboxMessages, ...rows] };
}

/** The last seed step (spec G1, audit U-28): healthy payables, time off for all, Outbox history. Its own random stream. */
export function withFinalTouches(ctx: GenContext, f: CompanyFixtures): CompanyFixtures {
  const rng = new Rng(ctx.company.seed + 23);
  return withOutboxHistory(ctx, withTimeOffForAll(ctx, rng, withHealthyPayables(ctx, rng, f)));
}
