import type { AccountingSettings, PaymentMethod } from "@workspace/shared";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import type { AuthHarness } from "../auth-harness";
import { decimalProblems } from "./json-walk";
import type { TrialBalance } from "./ledger-read";

/** The HTTP verbs the money actions use. */
export type Verb = "get" | "post" | "put";

/** One request the money tests send: verb, path and JSON body. */
export interface Call {
  verb: Verb;
  path: string;
  body?: object;
}

/** What the API answered to one call. */
export interface Answer {
  call: Call;
  status: number;
  /** Supertest's parsed JSON body, read only through typed helpers. */
  body: unknown;
}

/** The ErrorBody of a refusal (docs/api-contract.md). */
export interface Refusal {
  code: string;
  message: string;
}

/** A small file that starts like a PDF, as the proof every payment, bill and expense needs. */
export const PROOF = { name: "proof.pdf", data: Buffer.from("%PDF-1.4\n% proof\n").toString("base64") };

/** The job site every money test customer has, in Denver, so roll invoices can be priced (sales rule 39). */
export const JOB_SITE = { street: "12 Pine Rd", city: "Denver", state: "CO", zip: "80202" };

/**
 * The API as the web proxy calls it, for the money tests. Every answer is swept for decimal
 * strings as it arrives (MI-3; CLAUDE.md rule 6), keeping only the problems, so a long run holds no
 * bodies; a wrong status fails with the answer's body.
 */
export class MoneyApi {
  /** How many answers arrived. */
  answered = 0;
  /** Each decimal problem seen, as `VERB /path: field problem at $.path`. */
  readonly decimalIssues: string[] = [];

  constructor(private readonly harness: AuthHarness) {}

  /** Sends a call as the person whose session cookie is given, and sweeps the answer. */
  async send(call: Call, cookie: string): Promise<Answer> {
    let pending = request(this.harness.app.getHttpServer())
      [call.verb](call.path)
      .set("X-Forwarded-Host", "localhost:3000")
      .set("Cookie", cookie);
    if (call.body !== undefined) pending = pending.send(call.body);
    const response = await pending;
    const answer: Answer = { call, status: response.status, body: response.body as unknown };
    this.answered += 1;
    for (const problem of decimalProblems(answer.body)) {
      this.decimalIssues.push(
        `${call.verb.toUpperCase()} ${call.path}: ${problem.field} ${problem.problem} at ${problem.path}`,
      );
    }
    return answer;
  }

  /** Sends a call and returns its body, failing with the answer when the status is not the one expected. */
  async expect<T>(status: number, call: Call, cookie: string): Promise<T> {
    const answer = await this.send(call, cookie);
    if (answer.status !== status) {
      throw new Error(
        `${call.verb.toUpperCase()} ${call.path} answered ${answer.status}, expected ${status}: ${JSON.stringify(answer.body)}`,
      );
    }
    return answer.body as T;
  }

  /** A read that must answer 200. */
  read<T>(path: string, cookie: string): Promise<T> {
    return this.expect<T>(200, { verb: "get", path }, cookie);
  }

  /** The trial balance, read as someone with company-wide financial sight. */
  trialBalance(cookie: string): Promise<TrialBalance> {
    return this.read<TrialBalance>("/ledger/trial-balance", cookie);
  }
}

/** A refusal's code and message, when an answer is one. */
export function refusalOf(answer: Answer): Refusal | null {
  const body = answer.body as Partial<Refusal> | null;
  return answer.status >= 400 && typeof body?.code === "string" && typeof body.message === "string"
    ? { code: body.code, message: body.message }
    : null;
}

/** A reference no other payment uses, so the duplicate-reference check never interferes. */
function reference(prefix: string): string {
  return `${prefix}-${uuidv7().slice(-12)}`;
}

let checkNumbers = 1000;

/** The fields a payment needs for its method (sales rules 25 to 27): a check number, a card's last 4, a reference. */
function methodFields(method: PaymentMethod) {
  checkNumbers += 1;
  return {
    method,
    checkNumber: method === "check" ? String(checkNumbers) : "",
    cardLast4: method === "card" ? "4242" : "",
    reference: method === "cash" ? "" : reference(method.toUpperCase()),
  };
}

/** One quote line: a product by the sq ft, or a service with no product. */
export interface QuoteLine {
  productId?: string;
  description: string;
  category: "material" | "labor" | "freight" | "service";
  unit: "sq_ft" | "each" | "hour";
  quantity: string;
  unitPrice: string;
  /** The company's default for the product's category; Sales may not change it (spec rule 8). */
  wastePct?: string;
}

/** One purchase order line. */
export interface OrderLine {
  productId: string;
  description: string;
  quantity: string;
  unitCost: string;
}

/** One receipt line: good and damaged quantities and, for carpet, the rolls on the labels. */
export interface ReceiptLineInput {
  poLineId: string;
  productId: string;
  received: string;
  damaged: string;
  rolls: { rollNumber: string; dyeLot: string; lengthFt: string }[];
}

/** An expense as the form sends it (finance-expenses.md "The form"). */
export interface ExpenseInput {
  date: string;
  supplierId: string | null;
  category: string;
  locationId: string | null;
  amount: string;
  tax: string;
  paymentMethod: PaymentMethod;
  settlement: "paid" | "on_account";
}

/**
 * The requests behind every money event the check drives, with bodies copied from the existing
 * integration tests and checked against the controllers' Zod schemas. Each returns a `Call`; who
 * sends it, and what status counts, is the caller's.
 */
export const moneyCalls = {
  /** POST /customers: a customer with a name only. */
  customer: (name: string): Call => ({ verb: "post", path: "/customers", body: { name } }),

  /** PUT /customers/:id: gives a customer a Denver job site, which roll invoices take their tax from. */
  customerSite: (id: string, name: string): Call => ({
    verb: "put",
    path: `/customers/${id}`,
    body: {
      type: "homeowner",
      name,
      contactName: "",
      email: "",
      phone: "",
      terms: "due_on_receipt",
      defaultBillingId: null,
      defaultJobSiteId: "site-1",
      addresses: [{ id: "site-1", label: "job_site", ...JOB_SITE }],
    },
  }),

  /** POST /quotes: a quote shipping from a warehouse, no deposit, no tax override. */
  quote: (customerId: string, locationId: string, lines: readonly QuoteLine[]): Call => ({
    verb: "post",
    path: "/quotes",
    body: {
      customerId,
      locationId,
      jobSite: JOB_SITE,
      rooms: [],
      lines: lines.map((line, index) => ({ id: `draft-${index + 1}`, unitCost: "0", ...line })),
      depositPct: "0",
      taxOverride: null,
      notes: "",
    },
  }),

  /** POST /quotes/:id/status: send (with an expiry far ahead) or accept. */
  quoteStatus: (id: string, action: "send" | "accept"): Call => ({
    verb: "post",
    path: `/quotes/${id}/status`,
    body: action === "send" ? { action, expiresAt: "2099-01-01" } : { action },
  }),

  /** POST /quotes/:id/invoice: converts an accepted quote. */
  invoiceFromQuote: (id: string): Call => ({ verb: "post", path: `/quotes/${id}/invoice` }),

  /** POST /rolls/:id/invoice: a quick invoice for a length of one roll (inventory rule 18). */
  rollInvoice: (rollId: string, customerId: string, lengthFt: string): Call => ({
    verb: "post",
    path: `/rolls/${rollId}/invoice`,
    body: { customerId, lengthFt },
  }),

  /** POST /payments: a payment dated today, with proof; the extra above the balance becomes credit when asked. */
  payment: (invoiceId: string, amount: string, method: PaymentMethod, date: string, extraAsCredit = false): Call => ({
    verb: "post",
    path: "/payments",
    body: {
      invoiceId,
      kind: "payment",
      amount,
      date,
      ...methodFields(method),
      note: "",
      extraAsCredit,
      allowDuplicateReference: false,
      files: [PROOF],
    },
  }),

  /** POST /payments/:id/review: confirm, or reject with a reason. */
  paymentReview: (id: string, confirm: boolean): Call => ({
    verb: "post",
    path: `/payments/${id}/review`,
    body: confirm ? { action: "confirm" } : { action: "reject", reason: "Amount does not match the bank" },
  }),

  /** POST /payments/:id/void. */
  paymentVoid: (id: string): Call => ({
    verb: "post",
    path: `/payments/${id}/void`,
    body: { reason: "Check bounced" },
  }),

  /** POST /invoices/:id/credit-notes: a credit note for an amount before tax. */
  creditNote: (invoiceId: string, subtotal: string): Call => ({
    verb: "post",
    path: `/invoices/${invoiceId}/credit-notes`,
    body: { subtotal, reason: "Returned cartons" },
  }),

  /** POST /invoices/:id/write-off: writes off a small leftover. */
  writeOff: (invoiceId: string): Call => ({
    verb: "post",
    path: `/invoices/${invoiceId}/write-off`,
    body: { reason: "Small leftover" },
  }),

  /** POST /invoices/:id/apply-credit. */
  applyCredit: (invoiceId: string): Call => ({ verb: "post", path: `/invoices/${invoiceId}/apply-credit` }),

  /** POST /refunds: pays customer credit back, with proof. */
  refund: (customerId: string, amount: string, method: PaymentMethod, date: string): Call => ({
    verb: "post",
    path: "/refunds",
    body: {
      customerId,
      amount,
      date,
      method,
      reference: method === "cash" ? "" : reference("RF"),
      note: "",
      files: [PROOF],
    },
  }),

  /** POST /invoices/:id/void. */
  voidInvoice: (invoiceId: string): Call => ({
    verb: "post",
    path: `/invoices/${invoiceId}/void`,
    body: { reason: "Customer cancelled" },
  }),

  /** POST /reservations/:id/issue: issues boxed stock or cuts a roll for a paid invoice. */
  issue: (reservationId: string): Call => ({ verb: "post", path: `/reservations/${reservationId}/issue`, body: {} }),

  /** POST /suppliers: a goods or services supplier on net 30. */
  supplier: (name: string, type: "goods" | "services"): Call => ({
    verb: "post",
    path: "/suppliers",
    body: { name, type, terms: "net_30", email: "orders@example.test" },
  }),

  /** POST /purchase-orders: an order to one warehouse, as a draft or placed. */
  purchaseOrder: (supplierId: string, locationId: string, lines: readonly OrderLine[], asDraft: boolean): Call => ({
    verb: "post",
    path: "/purchase-orders",
    body: {
      supplierId,
      contactId: null,
      supplierRef: "",
      placedVia: asDraft ? null : "email",
      expectedAt: "2099-01-01",
      locationId,
      lines: lines.map((line) => ({ ...line, unit: "sq_ft" })),
      asDraft,
    },
  }),

  /** POST /purchase-orders/:id/order: places a draft order by email. */
  placeOrder: (id: string): Call => ({ verb: "post", path: `/purchase-orders/${id}/order`, body: { via: "email" } }),

  /** POST /purchase-orders/:id/receipts: into the order's warehouse. */
  receipt: (poId: string, lines: readonly ReceiptLineInput[]): Call => ({
    verb: "post",
    path: `/purchase-orders/${poId}/receipts`,
    body: { locationId: "", note: "", lines },
  }),

  /** POST /purchase-orders/:id/bills: the supplier's bill over every unbilled receipt, with its file. */
  bill: (poId: string, total: string, issuedAt: string): Call => ({
    verb: "post",
    path: `/purchase-orders/${poId}/bills`,
    body: { number: reference("BILL"), issuedAt, total, files: [PROOF] },
  }),

  /** POST /supplier-payments: pays chosen bills, or the oldest due first when none is named. */
  supplierPayment: (
    supplierId: string,
    amount: string,
    method: PaymentMethod,
    date: string,
    billIds?: readonly string[],
  ): Call => ({
    verb: "post",
    path: "/supplier-payments",
    body: {
      supplierId,
      amount,
      date,
      method,
      reference: method === "cash" ? "" : reference("SP"),
      note: "",
      files: [PROOF],
      ...(billIds ? { billIds } : {}),
    },
  }),

  /** POST /supplier-payments/:id/review. */
  supplierPaymentReview: (id: string, confirm: boolean): Call => ({
    verb: "post",
    path: `/supplier-payments/${id}/review`,
    body: confirm ? { action: "confirm" } : { action: "reject", reason: "Wrong amount" },
  }),

  /** POST /supplier-payments/:id/void. */
  supplierPaymentVoid: (id: string): Call => ({
    verb: "post",
    path: `/supplier-payments/${id}/void`,
    body: { reason: "Paid twice" },
  }),

  /** POST /expenses: recorded with its receipt, not as a draft. */
  expense: (input: ExpenseInput): Call => ({
    verb: "post",
    path: "/expenses",
    body: {
      ...input,
      reference: input.paymentMethod === "cash" ? "" : reference("EXP"),
      note: "",
      asDraft: false,
      files: [PROOF],
    },
  }),

  /** POST /expenses/:id/review: approve, or reject with a reason. */
  expenseReview: (id: string, approve: boolean): Call => ({
    verb: "post",
    path: `/expenses/${id}/review`,
    body: approve ? { action: "approve" } : { action: "reject", reason: "Wrong vendor" },
  }),

  /** POST /expenses/:id/void. */
  expenseVoid: (id: string): Call => ({
    verb: "post",
    path: `/expenses/${id}/void`,
    body: { reason: "Entered twice" },
  }),

  /** POST /stock/corrections: sets boxed stock at a warehouse, or a roll's length, to a count. */
  stockCorrection: (productId: string, rollId: string | null, locationId: string, counted: string): Call => ({
    verb: "post",
    path: "/stock/corrections",
    body: { productId, rollId, locationId, counted, reason: "Cycle count" },
  }),

  /** PUT /settings/accounting: the company's bank accounts and which payment methods post to each. */
  accounting: (settings: AccountingSettings): Call => ({ verb: "put", path: "/settings/accounting", body: settings }),

  /** POST /ledger/period-close: closes the books through a day. */
  periodClose: (through: string): Call => ({
    verb: "post",
    path: "/ledger/period-close",
    body: { through, note: "Month end" },
  }),
} as const;
