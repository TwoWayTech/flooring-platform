import { billingFigures } from "../../src/contracts/billing";
import { contractBill, contractInvoice } from "../../src/contracts/documents";
import { addDays } from "../../src/dates";
import { dec, moneyString, sum } from "../../src/money";
import { nextNumber } from "../../src/operations/quotes";
import type {
  BillingLine,
  ChangeOrder,
  CompanyFixtures,
  Contract,
  ContractBilling,
  ContractLine,
  Customer,
  InsuranceCertificate,
  LienWaiver,
  Payment,
  Supplier,
} from "../../src/types";
import type { GenContext } from "./context";
import { Rng } from "./random";

type LineSeed = [
  code: string,
  description: string,
  category: ContractLine["category"],
  value: string,
  billing?: ContractLine["billing"],
];

/** Mutable seed state, so each step sees what the last one posted. */
interface State {
  ctx: GenContext;
  f: CompanyFixtures;
  contracts: Contract[];
  lines: ContractLine[];
  orders: ChangeOrder[];
  billings: ContractBilling[];
  waivers: LienWaiver[];
  certificates: InsuranceCertificate[];
  invoices: CompanyFixtures["invoices"];
  bills: CompanyFixtures["bills"];
  payments: Payment[];
}

const SIGNED_FILE = (id: string, number: string, at: string) => ({
  id: `${id}-signed`,
  name: `Signed ${number}.pdf`,
  type: "application/pdf",
  size: 52480,
  uploadedBy: "Simulated signature",
  uploadedAt: at,
});

function addContract(
  s: State,
  input: Partial<Contract> & Pick<Contract, "direction" | "kind" | "title" | "scope" | "status">,
  party: Customer | Supplier,
  seeds: readonly LineSeed[],
  dates: { startsIn: number; endsIn: number },
): Contract {
  const { ctx, f } = s;
  const id = ctx.id("ctr");
  const number = `CTR-${1001 + s.contracts.length}`;
  const value = sum(seeds.map((l) => l[3]));
  const rep = "salesRepId" in party ? party.salesRepId : f.users[0]!.id;
  const branchId = f.users.find((u) => u.id === rep)?.branchId ?? f.users[0]!.branchId;
  const signed = !["draft", "sent"].includes(input.status);
  const startsAt = addDays(ctx.anchor, dates.startsIn);
  const signedAt = signed ? `${startsAt}T11:00` : null;
  const contract: Contract = {
    id,
    number,
    masterId: null,
    customerId: input.direction === "customer" ? party.id : null,
    supplierId: input.direction === "subcontractor" ? party.id : null,
    parentContractId: null,
    branchId,
    locationId: f.locations[0]!.id,
    jobSite: {
      street: "2200 Commerce Way",
      city: f.locations[0]!.address.city,
      state: ctx.company.state,
      zip: f.locations[0]!.address.zip,
    },
    salesRepId: rep,
    startsAt,
    endsAt: addDays(ctx.anchor, dates.endsIn),
    renewal: { mode: input.kind === "master" ? "manual" : "none", noticeDays: 30 },
    renewedFromId: null,
    originalValue: moneyString(value),
    retainagePct: input.kind === "master" ? "0" : "5",
    storedRetainagePct: input.kind === "master" ? "0" : "5",
    bondInLieu: false,
    taxTreatment: "on_billing",
    sentAt: input.status === "draft" ? null : `${addDays(startsAt, -3)}T09:00`,
    signedAt,
    signature: signed
      ? {
          documentId: id,
          version: 1,
          hash: `seed-${id}`,
          signerName: "contactName" in party ? party.contactName : party.name,
          signerEmail: party.email,
          signerRole: "Authorized signer",
          consentVersion: "demo-1",
          recordedBy: f.users[0]!.name,
          signedAt: signedAt!,
          events: [
            { kind: "sent", at: `${addDays(startsAt, -3)}T09:00` },
            { kind: "signed", at: signedAt! },
          ],
        }
      : null,
    substantialCompletionAt: null,
    finalAcceptanceAt: null,
    terminatedAt: null,
    terminationReason: null,
    closeOverrideReason: null,
    files: signed ? [SIGNED_FILE(id, number, signedAt!)] : [],
    notes: input.kind === "master" ? "Contractor price list applies. Net 30. Volume rebate reviewed each quarter." : "",
    ...input,
  };
  s.contracts.push(contract);
  seeds.forEach(([code, description, category, scheduledValue, billing = "percent"]) => {
    s.lines.push({
      id: `${id}-${code}`,
      contractId: id,
      code,
      description,
      category,
      billing,
      scheduledValue,
      retainagePct: null,
      storedRetainagePct: null,
      milestoneDueAt: billing === "milestone" ? addDays(ctx.anchor, dates.endsIn - 20) : null,
      changeOrderId: null,
      estimatedCost: moneyString(dec(scheduledValue).times("0.62")),
    });
  });
  return contract;
}

/** Posts one billing the way the store does, so seeded money reconciles with the same rules. */
function postBilling(s: State, contract: Contract, cumulative: Record<string, string>, on: string): ContractBilling {
  const { ctx, f } = s;
  const own = s.lines.filter((l) => l.contractId === contract.id);
  const past = s.billings.filter((b) => b.contractId === contract.id);
  const inputs: BillingLine[] = own.map((l) => ({
    lineId: l.id,
    completedToDate: cumulative[l.code] ?? "0",
    storedBalance: "0",
    retainagePct: contract.retainagePct,
    storedRetainagePct: contract.storedRetainagePct,
  }));
  const figures = billingFigures(inputs, past);
  const id = ctx.id("cbl");
  const amounts = figures.lines.map((l) => ({
    lineId: l.lineId,
    gross: moneyString(l.gross),
    withheld: moneyString(l.withheld),
    released: "0.00",
  }));
  const billing: ContractBilling = {
    id,
    contractId: contract.id,
    number: past.length + 1,
    kind: "progress",
    periodEnd: on,
    status: "posted",
    lines: inputs,
    releases: [],
    gross: moneyString(figures.gross),
    withheld: moneyString(figures.withheld),
    released: "0.00",
    invoiceId: null,
    billId: null,
    postedAt: `${on}T10:00`,
    postedBy: f.users[0]!.name,
  };
  if (contract.direction === "customer") {
    const customer = f.customers.find((c) => c.id === contract.customerId)!;
    const invoice = contractInvoice(contract, customer, own, amounts, f.settings.localization, {
      id: ctx.id("inv"),
      number: nextNumber(
        f.settings.localization.documents.invoicePrefix,
        s.invoices.map((i) => i.number),
        1001,
      ),
      issuedAt: on,
      createdBy: f.users[0]!.id,
      billingId: id,
    });
    invoice.sentAt = on;
    invoice.sentBy = f.users[0]!.id;
    s.invoices.push(invoice);
    billing.invoiceId = invoice.id;
  } else {
    const supplier = f.suppliers.find((x) => x.id === contract.supplierId)!;
    const bill = contractBill(
      contract,
      supplier,
      { gross: billing.gross, withheld: billing.withheld, released: "0.00" },
      { id: ctx.id("bill"), number: `${contract.number}-${billing.number}`, issuedAt: on, billingId: id },
    );
    s.bills.push(bill);
    billing.billId = bill.id;
  }
  s.billings.push(billing);
  return billing;
}

function confirmPayment(s: State, invoiceId: string, date: string): Payment {
  const { ctx, f } = s;
  const invoice = s.invoices.find((i) => i.id === invoiceId)!;
  const id = ctx.id("pay");
  const payment: Payment = {
    id,
    number: nextNumber(
      f.settings.payments.paymentPrefix,
      s.payments.map((p) => p.number),
      1,
    ),
    invoiceId,
    customerId: invoice.customerId,
    kind: "payment",
    amount: invoice.total,
    date,
    method: "ach",
    checkNumber: "",
    cardLast4: "",
    reference: `ACH-${date.replaceAll("-", "")}`,
    note: "",
    files: [
      {
        id: `${id}-proof`,
        name: "ACH confirmation.pdf",
        type: "application/pdf",
        size: 38120,
        uploadedBy: f.users[0]!.name,
        uploadedAt: `${date}T14:00`,
      },
    ],
    status: "confirmed",
    recordedById: f.users[0]!.id,
    recordedBy: f.users[0]!.name,
    recordedAt: `${date}T14:00`,
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
  };
  s.payments.push(payment);
  return payment;
}

/** A subcontractor to hire: the Services supplier the two subcontracts are with (plan K-9). */
function subcontractor(ctx: GenContext, rng: Rng, f: CompanyFixtures): Supplier {
  const name = ctx.company.id === "summit" ? "Front Range Install Crew LLC" : "Susquehanna Floor Installers LLC";
  return {
    id: ctx.id("sup"),
    name,
    type: "services",
    status: "active",
    accountNumber: `SUB-${rng.int(1000, 9999)}`,
    email: `office@${name.split(" ")[0]!.toLowerCase()}crew.example`,
    phone: rng.phone(ctx.company.areaCode),
    terms: "net_30",
    creditLimit: "0.00",
    categories: [],
    address: f.locations[0]!.address,
    track1099: true,
    taxForm: {
      w9OnFile: true,
      receivedAt: addDays(ctx.anchor, -200),
      legalName: name,
      entityType: "LLC",
      exemptFromReporting: false,
    },
    notes: "Installation subcontractor.",
  };
}

/**
 * Three customer and two subcontractor contracts at different stages (spec G1), on their own random
 * stream so nothing before them changes. Billings run through the same calculators as the store.
 */
export function withContracts(ctx: GenContext, f: CompanyFixtures): CompanyFixtures {
  if (f.invoices.length === 0) return f;
  const rng = new Rng(ctx.company.seed + 13);
  const sub = subcontractor(ctx, rng, f);
  const commercial = f.customers.filter((c) => c.type !== "homeowner");
  const s: State = {
    ctx,
    f: { ...f, suppliers: [...f.suppliers, sub] },
    contracts: [],
    lines: [],
    orders: [],
    billings: [],
    waivers: [],
    certificates: [],
    invoices: [...f.invoices],
    bills: [...f.bills],
    payments: [...f.payments],
  };
  const [a = f.customers[0]!, b = f.customers[1]!, c = f.customers[2]!] = commercial;

  const active = addContract(
    s,
    {
      direction: "customer",
      kind: "project",
      title: "Ridgeline condos, phase 2",
      scope: "LVP and carpet in 48 units, common halls.",
      status: "active",
    },
    a,
    [
      ["L1", "Materials", "material", "72000.00"],
      ["L2", "Installation labor", "labor", "48000.00"],
      ["M1", "Final walkthrough", "labor", "6000.00", "milestone"],
    ],
    { startsIn: -70, endsIn: 45 },
  );
  const first = postBilling(s, active, { L1: "30000.00", L2: "6000.00" }, addDays(ctx.anchor, -45));
  const paid = confirmPayment(s, first.invoiceId!, addDays(ctx.anchor, -20));
  postBilling(s, active, { L1: "42000.00", L2: "24000.00" }, addDays(ctx.anchor, -14));
  s.waivers.push({
    id: ctx.id("lwv"),
    contractId: active.id,
    direction: "given",
    type: "unconditional_progress",
    paymentId: paid.id,
    supplierPaymentId: null,
    amount: paid.amount,
    throughDate: first.periodEnd,
    state: ctx.company.state,
    statutoryForm: false,
    signedOn: paid.date,
    files: [],
    status: "received",
  });
  s.orders.push({
    id: ctx.id("cor"),
    number: "CO-1",
    contractId: active.id,
    status: "pending",
    reason: "Add sound underlayment on floors 2 and 3.",
    lines: [{ lineId: null, description: "Sound underlayment", category: "material", amountDelta: "15000.00" }],
    submittedAt: `${addDays(ctx.anchor, -6)}T15:00`,
    decidedAt: null,
    decidedBy: null,
    decisionReason: null,
    files: [],
  });

  const done = addContract(
    s,
    {
      direction: "customer",
      kind: "project",
      title: "Harvest Commons clubhouse",
      scope: "Tile and hardwood, clubhouse and fitness room.",
      status: "completed",
      substantialCompletionAt: addDays(ctx.anchor, -9),
    },
    b,
    [
      ["L1", "Materials", "material", "27000.00"],
      ["L2", "Installation labor", "labor", "13000.00"],
    ],
    { startsIn: -120, endsIn: -5 },
  );
  const last = postBilling(s, done, { L1: "27000.00", L2: "13000.00" }, addDays(ctx.anchor, -12));
  confirmPayment(s, last.invoiceId!, addDays(ctx.anchor, -3));

  addContract(
    s,
    {
      direction: "customer",
      kind: "master",
      title: "Builder master agreement",
      scope: "Pricing, terms and credit for all projects.",
      status: "active",
    },
    c,
    [],
    { startsIn: -300, endsIn: 50 },
  );

  const hired = addContract(
    s,
    {
      direction: "subcontractor",
      kind: "project",
      title: "Ridgeline labor subcontract",
      scope: "Install all LVP and carpet per plans.",
      status: "active",
      parentContractId: active.id,
    },
    sub,
    [["L1", "Installation labor", "labor", "18500.00"]],
    { startsIn: -65, endsIn: 40 },
  );
  postBilling(s, hired, { L1: "7400.00" }, addDays(ctx.anchor, -16));
  s.certificates.push({
    id: ctx.id("coi"),
    supplierId: sub.id,
    contractId: hired.id,
    producer: "Foothills Insurance Agency",
    holder: f.settings.profile.legalName,
    additionalInsured: true,
    files: [],
    coverages: [
      {
        type: "general",
        insurer: "Mountain Mutual",
        policyNumber: "GL-44120",
        effectiveOn: addDays(ctx.anchor, -345),
        expiresOn: addDays(ctx.anchor, 20),
        limits: "$1,000,000 per occurrence",
      },
      {
        type: "workers_comp",
        insurer: "Mountain Mutual",
        policyNumber: "WC-88012",
        effectiveOn: addDays(ctx.anchor, -150),
        expiresOn: addDays(ctx.anchor, 215),
        limits: "Statutory",
      },
    ],
  });
  s.waivers.push({
    id: ctx.id("lwv"),
    contractId: hired.id,
    direction: "received",
    type: "conditional_progress",
    paymentId: null,
    supplierPaymentId: null,
    amount: "6660.00",
    throughDate: addDays(ctx.anchor, -16),
    state: ctx.company.state,
    statutoryForm: false,
    signedOn: null,
    files: [],
    status: "requested",
  });

  addContract(
    s,
    {
      direction: "subcontractor",
      kind: "project",
      title: "Harvest Commons tile setter",
      scope: "Set tile in the fitness room.",
      status: "sent",
    },
    sub,
    [["L1", "Tile labor", "labor", "6200.00"]],
    { startsIn: -2, endsIn: 60 },
  );

  return {
    ...s.f,
    invoices: s.invoices,
    bills: s.bills,
    payments: s.payments,
    contracts: s.contracts,
    contractLines: s.lines,
    changeOrders: s.orders,
    contractBillings: s.billings,
    lienWaivers: s.waivers,
    insuranceCertificates: s.certificates,
  };
}
