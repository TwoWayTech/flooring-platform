import { addDays } from "../../src/dates";
import { dec } from "../../src/money";
import { depositAmount } from "../../src/documents";
import type { CompanySettings, Invoice, Payment, PaymentMethod, User } from "../../src/types";

/** A payment as the sales generator draws it, before numbering and proof are added. */
export interface DrawnPayment {
  id: string;
  invoiceId: string;
  customerId: string;
  date: string;
  amount: string;
  method: PaymentMethod;
}

/** How many recent large payments still wait for a second person, so "payments to verify" shows. */
const AWAITING_VERIFICATION = 3;
/** Only payments recorded this many days before the anchor may still be waiting. */
const VERIFICATION_WINDOW_DAYS = 7;

const roleHolder = (users: readonly User[], role: string) => users.find((u) => u.roleIds.some((r) => r.endsWith(role)));

/** A stable number from a payment's sequence, for check numbers, card digits and references. */
const digits = (seq: number, salt: number, length: number) =>
  String(((seq * 7919 + salt * 104729) % 10 ** length) + 10 ** (length - 1)).slice(-length);

function reference(
  method: PaymentMethod,
  seq: number,
  date: string,
): Pick<Payment, "checkNumber" | "cardLast4" | "reference"> {
  const day = date.slice(2).replaceAll("-", "");
  switch (method) {
    case "check": {
      const checkNumber = String(1000 + (seq % 8000));
      return { checkNumber, cardLast4: "", reference: `CHK-${checkNumber}` };
    }
    case "card":
      return { checkNumber: "", cardLast4: digits(seq, 3, 4), reference: `AUTH-${digits(seq, 5, 6)}` };
    case "ach":
      return { checkNumber: "", cardLast4: "", reference: `ACH-${day}-${digits(seq, 7, 4)}` };
    case "other":
      return { checkNumber: "", cardLast4: "", reference: `REF-${digits(seq, 11, 6)}` };
    default:
      return { checkNumber: "", cardLast4: "", reference: "" };
  }
}

/**
 * Turns drawn payments into full payment records (spec Appendix A, Batch H fixtures): PAY-0001
 * numbers in date order, a deposit flag on the first payment of a deposit invoice, a reference
 * and a placeholder proof PDF each, recorded by the accountant (else the owner). Where approval is
 * on, payments above the threshold were confirmed by the owner, except the latest few, which
 * still wait. No random numbers are drawn, so the rest of the fixtures stay the same.
 */
export function finishPayments(
  drawn: readonly DrawnPayment[],
  invoices: readonly Invoice[],
  users: readonly User[],
  settings: CompanySettings,
  anchor: string,
): Payment[] {
  const recorder = roleHolder(users, "-role-accountant") ?? roleHolder(users, "-role-owner")!;
  const approver = roleHolder(users, "-role-owner")!;
  const { approvalRequired, approvalThreshold, paymentPrefix } = settings.payments;
  const ordered = [...drawn].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const firstOf = new Map<string, string>();
  for (const p of ordered) if (!firstOf.has(p.invoiceId)) firstOf.set(p.invoiceId, p.id);
  const needsCheck = (p: DrawnPayment) =>
    approvalRequired && (!approvalThreshold || dec(p.amount).gt(approvalThreshold));
  const waiting = new Set(
    ordered
      .filter((p) => needsCheck(p) && p.date > addDays(anchor, -VERIFICATION_WINDOW_DAYS))
      .slice(-AWAITING_VERIFICATION)
      .map((p) => p.id),
  );
  return ordered.map((p, i): Payment => {
    const seq = i + 1;
    const number = `${paymentPrefix}${String(seq).padStart(4, "0")}`;
    const invoice = invoices.find((inv) => inv.id === p.invoiceId)!;
    const deposit =
      firstOf.get(p.invoiceId) === p.id &&
      dec(invoice.depositPct).gt(0) &&
      dec(p.amount).eq(depositAmount(invoice.total, invoice.depositPct));
    const recordedAt = `${p.date}T${String(9 + (seq % 8)).padStart(2, "0")}:${String((seq * 13) % 60).padStart(2, "0")}`;
    const reviewed = needsCheck(p) && !waiting.has(p.id);
    return {
      id: p.id,
      number,
      invoiceId: p.invoiceId,
      customerId: p.customerId,
      kind: deposit ? "deposit" : "payment",
      amount: p.amount,
      date: p.date,
      method: p.method,
      ...reference(p.method, seq, p.date),
      note: "",
      files: [
        {
          id: `${p.id}-proof`,
          name: `${number}-${p.method === "check" ? "check-photo" : "receipt"}.pdf`,
          type: "application/pdf",
          size: 2400 + ((seq * 37) % 900),
          uploadedBy: recorder.name,
          uploadedAt: recordedAt,
        },
      ],
      status: waiting.has(p.id) ? "pending" : "confirmed",
      recordedBy: recorder.name,
      recordedAt,
      reviewedBy: reviewed ? approver.name : null,
      reviewedAt: reviewed ? `${p.date}T17:00` : null,
      rejectReason: null,
      voidedBy: null,
      voidedAt: null,
      voidReason: null,
    };
  });
}
