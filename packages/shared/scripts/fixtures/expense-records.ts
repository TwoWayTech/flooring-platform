import { shareByWeight, fromCents, toCents } from "../../src/cost-sharing";
import { addDays, last12Months } from "../../src/dates";
import { dec, moneyString, sum } from "../../src/money";
import type { CompanyFixtures, Expense, ExpenseCategory, FileMeta, RecurringExpense } from "../../src/types";
import type { GenContext } from "./context";
import { Rng } from "./random";

const VENDOR_FOR: Partial<Record<ExpenseCategory, string>> = {
  rent: "Redrock Property Management",
  electricity: "Frontier Power and Light",
  water: "Metro Water District",
  internet_phone: "Peakline Internet and Phone",
  professional_fees: "Ledger and Pine CPAs",
  insurance: "Harbor Mutual Insurance",
  marketing: "BrightSign Marketing",
  fuel_vehicles: "FastLane Fleet Fuel",
  taxes_licenses: "State Revenue Office",
  sales_tax_payment: "State Revenue Office",
  maintenance: "Tidewell Facility Services",
};

const receipt = (id: string, date: string, by: string): FileMeta => ({
  id: `${id}-receipt`,
  name: "Receipt.pdf",
  type: "application/pdf",
  size: 41200,
  uploadedBy: by,
  uploadedAt: `${date}T16:00`,
});

/**
 * Turns the seeded operating costs into full expense records (spec G1, ADR 0023): rent and
 * electricity split into direct records per location by floor area, exactly, so monthly totals do
 * not move; vendors, receipts, sales tax payments, a recurring template and a few in other states.
 */
export function withExpenseRecords(ctx: GenContext, f: CompanyFixtures): CompanyFixtures {
  if (f.expenses.length === 0) return f;
  const rng = new Rng(ctx.company.seed + 19);
  const by = f.users[0]!;
  const vendorId = (category: ExpenseCategory) => f.suppliers.find((s) => s.name === VENDOR_FOR[category])?.id ?? null;
  const weights = f.locations.map((l) => ({ id: l.id, weight: toCents(l.floorAreaSqFt ?? "0") }));
  const full = (e: Expense, locationId: string | null, amount: string, suffix = ""): Expense => {
    const id = `${e.id}${suffix}`;
    return {
      ...e,
      id,
      amount,
      locationId,
      supplierId: vendorId(e.category),
      files: e.category === "payroll" ? [] : [receipt(id, e.date, by.name)],
      recordedById: by.id,
      recordedBy: by.name,
      recordedAt: `${e.date}T16:00`,
    };
  };
  const split = f.expenses.flatMap((e) => {
    if (e.category !== "rent" && e.category !== "electricity") return [full(e, null, e.amount)];
    return [...shareByWeight(toCents(e.amount), weights).entries()].map(([locationId, cents], i) =>
      full(e, locationId, moneyString(fromCents(cents)), `-${i + 1}`),
    );
  });
  const months = last12Months(ctx.anchor);
  const taxPayments: Expense[] = months.slice(0, -1).map((month, i) => {
    const collected = sum(
      f.invoices
        .filter((inv) => inv.issuedAt.startsWith(month) && !inv.voidedAt)
        .map((inv) => (inv.isReturn ? dec(inv.tax).negated() : inv.tax)),
    );
    const date = `${months[i + 1]}-20`;
    const id = ctx.id("exp");
    return full(
      {
        ...EMPTY,
        id,
        date,
        category: "sales_tax_payment",
        amount: moneyString(collected),
        note: `Sales tax for ${month}`,
        paymentMethod: "ach",
        reference: `TAX-${month}`,
      },
      null,
      moneyString(collected),
    );
  });
  const direct: Expense[] = f.locations
    .flatMap((loc) =>
      months.map((month) => {
        const id = ctx.id("exp");
        const date = `${month}-${String(rng.int(3, 26)).padStart(2, "0")}`;
        return full(
          {
            ...EMPTY,
            id,
            date,
            category: "maintenance",
            amount: rng.money(90, 620),
            tax: rng.money(4, 40),
            note: "Cleaning and repairs",
          },
          loc.id,
          rng.money(90, 620),
        );
      }),
    )
    .filter((e) => e.date <= ctx.anchor);
  const templates: RecurringExpense[] = [
    {
      id: ctx.id("rex"),
      supplierId: vendorId("internet_phone") ?? "",
      category: "internet_phone",
      locationId: null,
      amount: rng.money(240, 380),
      tax: "0.00",
      paymentMethod: "ach",
      frequency: "monthly",
      dayOfMonth: 5,
      startsOn: addDays(ctx.anchor, -32),
      endsOn: null,
      active: true,
      note: "Internet and phone plan",
    },
    ...f.locations.slice(0, 2).map((l, i): RecurringExpense => ({
      id: ctx.id("rex"),
      supplierId: vendorId(i === 0 ? "rent" : "electricity") ?? "",
      category: i === 0 ? "rent" : "electricity",
      locationId: l.id,
      amount: rng.money(i === 0 ? 4200 : 310, i === 0 ? 6800 : 620),
      tax: "0.00",
      paymentMethod: "ach",
      frequency: "monthly",
      dayOfMonth: 1,
      startsOn: addDays(ctx.anchor, 4),
      endsOn: null,
      active: true,
      note: i === 0 ? "Warehouse lease" : "Electricity, estimated",
    })),
  ];
  const pending = full(
    {
      ...EMPTY,
      id: ctx.id("exp"),
      date: addDays(ctx.anchor, -4),
      category: "professional_fees",
      amount: "2850.00",
      status: "pending",
      note: "Year-end review, retainer",
    },
    null,
    "2850.00",
  );
  const draft = {
    ...full(
      {
        ...EMPTY,
        id: ctx.id("exp"),
        date: addDays(ctx.anchor, -1),
        category: "supplies",
        amount: "184.20",
        tax: "11.06",
        status: "draft",
        note: "Showroom supplies",
      },
      f.locations.at(-1)!.id,
      "184.20",
    ),
    files: [],
  };
  const onAccount = full(
    {
      ...EMPTY,
      id: ctx.id("exp"),
      date: addDays(ctx.anchor, -10),
      category: "marketing",
      amount: "1275.00",
      settlement: "on_account",
      dueAt: addDays(ctx.anchor, 20),
      note: "Trade show booth",
    },
    null,
    "1275.00",
  );
  const billId = ctx.id("bill");
  const all = [...split, ...taxPayments, ...direct, pending, draft, { ...onAccount, billId }]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    .map((e, i) => ({ ...e, number: `EXP-${String(i + 1).padStart(4, "0")}` }));
  const linked = all.find((e) => e.billId === billId)!;
  return {
    ...f,
    expenses: all,
    recurringExpenses: templates,
    bills: [
      ...f.bills,
      {
        id: billId,
        number: linked.number,
        supplierId: linked.supplierId!,
        poId: null,
        receiptIds: [],
        issuedAt: linked.date,
        dueAt: linked.dueAt!,
        total: moneyString(dec(linked.amount).plus(linked.tax)),
        matchIssues: [],
        files: linked.files,
      },
    ],
  };
}

/** A record's fields before withExpenseRecords fills them in. */
export const EMPTY: Omit<Expense, "id" | "date" | "category"> = {
  number: "",
  supplierId: null,
  locationId: null,
  amount: "0.00",
  tax: "0.00",
  paymentMethod: "ach",
  reference: "",
  files: [],
  note: "",
  status: "confirmed",
  settlement: "paid",
  dueAt: null,
  billId: null,
  recurringId: null,
  period: null,
  recordedById: "",
  recordedBy: "",
  recordedAt: "",
  reviewedBy: null,
  reviewedAt: null,
  rejectReason: null,
  voidedBy: null,
  voidedAt: null,
  voidReason: null,
};
