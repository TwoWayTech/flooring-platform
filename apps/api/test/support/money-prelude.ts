import { dec, moneyString, type Invoice, type Payment } from "@workspace/shared";
import { CARPET, TILE } from "./company-bootstrap";
import { moneyCalls } from "./money-actions";
import {
  applyCredit,
  carpetArea,
  correctStock,
  creditNote,
  enterBill,
  issueStock,
  moveMethod,
  paySupplier,
  purchaseOrder,
  quotedInvoice,
  receive,
  recordExpense,
  recordPayment,
  refund,
  reviewExpense,
  reviewPayment,
  reviewSupplierPayment,
  rollInvoice,
  saveBanks,
  serviceLine,
  tileCartons,
  tileLine,
  voidExpense,
  voidInvoice,
  voidPayment,
  voidSupplierPayment,
  writeOff,
} from "./money-ops";
import type { MoneyRun } from "./money-run";

/** The suppliers and customers the prelude makes, which the random tail goes on using. */
export interface MoneyCast {
  /** Goods supplier, then a services supplier, then the state's revenue department. */
  suppliers: { goods: string; services: string; government: string };
  /** Customers made by Sales (own scope), each with a Denver job site. */
  customers: string[];
}

/** The event kinds the prelude guarantees at least once (MI-1 step 7). */
export const PRELUDE_EVENTS = [
  "bank accounts saved",
  "purchase order",
  "receipt with damage",
  "receipt",
  "bill",
  "bill with a price difference",
  "supplier payment confirmed",
  "supplier payment pending",
  "supplier payment confirmed on review",
  "supplier payment voided",
  "invoice",
  "roll invoice",
  "payment confirmed",
  "payment pending",
  "payment confirmed on review",
  "payment rejected",
  "payment voided",
  "stock issued",
  "roll cut",
  "credit applied",
  "write-off",
  "credit note",
  "refund",
  "invoice voided",
  "expense paid confirmed",
  "expense on_account pending",
  "expense approved",
  "expense voided",
  "sales tax payment",
  "stock correction",
  "payment method moved",
] as const;

/** A unique roll label for this run. */
function rollNumber(run: MoneyRun, n: number): string {
  return `R${run.seed}-${n}`;
}

/** The latest state of a payment, from the books after the last step. */
function paymentNow(run: MoneyRun, id: string): Payment {
  return run.books.payments.find((payment) => payment.id === id)!;
}

/**
 * The deterministic start of every money run (MF-6): every event kind at least once, in an order
 * the rules allow, with amounts chosen so each case really happens (an overpayment, a leftover
 * small enough to write off, a bill over its receipts, a payment above the threshold, a cut that
 * leaves the roll whole). No refusal is allowed here. Order changes from the plan are recorded in
 * the session log.
 */
export async function runPrelude(run: MoneyRun): Promise<MoneyCast> {
  const [denver] = run.places.warehouses;
  const { tile, carpet } = run.places;
  const cast: MoneyCast = { suppliers: { goods: "", services: "", government: "" }, customers: [] };

  await run.step("banks: Operating takes check and ACH, Merchant takes card", async () => {
    await saveBanks(run, [
      { name: "Operating", methods: ["check", "ach"] },
      { name: "Merchant", methods: ["card"] },
      { name: "Reserve", methods: [] },
    ]);
  });
  await run.step("suppliers: goods, services and the state revenue department", async () => {
    const make = async (name: string, type: "goods" | "services") =>
      (await run.act<{ id: string }>(201, moneyCalls.supplier(name, type), run.actors.purchasing)).id;
    cast.suppliers = {
      goods: await make(`Peak Tile Supply ${run.seed}`, "goods"),
      services: await make(`Front Range Services ${run.seed}`, "services"),
      government: await make(`State Revenue ${run.seed}`, "services"),
    };
  });
  await run.step("customers C1, C2 and C3 by Sales, each given a job site by the Owner", async () => {
    for (const name of ["Ada Moss", "Ben Ortiz", "Cara Lund"]) {
      const created = await run.act<{ id: string }>(201, moneyCalls.customer(`${name} ${run.seed}`), run.actors.sales);
      await run.act(200, moneyCalls.customerSite(created.id, `${name} ${run.seed}`), run.owner);
      cast.customers.push(created.id);
    }
  });
  const [c1, c2, c3] = cast.customers as [string, string, string];

  let po1 = await purchaseOrderStep(run, cast);
  await run.step("R1: 200 sq ft of tile in, 40 sq ft (2 cartons) damaged", async () => {
    await receive(run, po1, [
      { poLineId: po1.lines[0]!.id, productId: tile, received: "200", damaged: tileCartons(2), rolls: [] },
    ]);
  });
  let b1 = "";
  await run.step("B1: the bill for R1 at its received value", async () => {
    b1 = (await enterBill(run, po1.id)).id;
  });
  await run.step("R2: the other 160 sq ft of tile, and one 100 ft roll of carpet", async () => {
    po1 = run.books.orders.find((order) => order.id === po1.id)!;
    await receive(run, po1, [
      { poLineId: po1.lines[0]!.id, productId: tile, received: "160", damaged: "0", rolls: [] },
      {
        poLineId: po1.lines[1]!.id,
        productId: carpet,
        received: carpetArea("100"),
        damaged: "0",
        rolls: [{ rollNumber: rollNumber(run, 1), dyeLot: "A1", lengthFt: "100" }],
      },
    ]);
  });
  let b2 = "";
  await run.step("B2: the bill for R2, 10.00 over its received value (a price difference)", async () => {
    b2 = (await enterBill(run, po1.id, "10.00")).id;
  });
  await run.step("SP1: B1 paid in full in cash, confirmed at once", async () => {
    await paySupplier(run, cast.suppliers.goods, run.books.bills.find((b) => b.id === b1)!.total, "cash", [b1]);
  });
  await run.step("SP2: 300.00 on B2 by check, then voided", async () => {
    const paid = await paySupplier(run, cast.suppliers.goods, "300.00", "check", [b2]);
    await voidSupplierPayment(run, paid.id);
  });
  await run.step("SP3: 1,200.00 on B2 by ACH, over the threshold, confirmed by the Owner", async () => {
    const paid = await paySupplier(run, cast.suppliers.goods, "1200.00", "ach", [b2]);
    await reviewSupplierPayment(run, paid.id, true);
  });

  let i1: Invoice | undefined;
  let p1 = "";
  await run.step(
    "I1: C1 buys 160 sq ft (8 cartons) of tile; P1 pays it by check over the threshold; the Accountant confirms",
    async () => {
      i1 = await quotedInvoice(run, c1, [tileLine(tile, tileCartons(8))]);
      const p = await recordPayment(run, i1.id, i1.total, "check", "owner");
      p1 = p.id;
      await reviewPayment(run, p, true);
    },
  );
  await run.step("I1's tile is issued at the average cost", async () => {
    await issueStock(run, i1!.id);
  });
  await run.step("I2: C1 buys 20 sq ft; P2 pays 120.00 cash, the extra becoming credit", async () => {
    const i2 = await quotedInvoice(run, c1, [tileLine(tile, tileCartons(1))]);
    await recordPayment(run, i2.id, "120.00", "cash", "owner", true);
  });
  await run.step("I3: C1 buys 20 sq ft and the Owner applies C1's credit to it", async () => {
    const i3 = await quotedInvoice(run, c1, [tileLine(tile, tileCartons(1))]);
    await applyCredit(run, i3.id);
  });
  await run.step("I4: C2 buys 20 sq ft, pays all but 2.93 by card, and the rest is written off", async () => {
    const i4 = await quotedInvoice(run, c2, [tileLine(tile, tileCartons(1))]);
    await recordPayment(run, i4.id, moneyString(dec(i4.total).minus("2.93")), "card", "owner");
    await writeOff(run, i4.id);
  });
  await run.step(
    "I5: C2 buys 40 sq ft and pays in full; a 50.00 credit note; 30.00 of the credit refunded by check",
    async () => {
      const i5 = await quotedInvoice(run, c2, [tileLine(tile, tileCartons(2))]);
      await recordPayment(run, i5.id, i5.total, "cash", "owner");
      await creditNote(run, i5.id, "50.00");
      await refund(run, c2, "30.00", "check");
    },
  );
  await run.step("I6: C3 buys 20 sq ft; Sales's P4 is rejected; the Owner's P5 is confirmed, then voided", async () => {
    const i6 = await quotedInvoice(run, c3, [tileLine(tile, tileCartons(1))]);
    const p4 = await recordPayment(run, i6.id, "50.00", "cash", "sales");
    await reviewPayment(run, p4, false);
    const p5 = await recordPayment(run, i6.id, "50.00", "cash", "owner");
    await voidPayment(run, p5.id);
  });
  await run.step("I7: C3 books a measure visit only, and the invoice is voided", async () => {
    const i7 = await quotedInvoice(run, c3, [serviceLine(run.places.service)]);
    await voidInvoice(run, i7.id);
  });
  let i8: Invoice | undefined;
  await run.step(
    "I8: Sales sells C1 a 30 ft cut of the roll; paid by ACH over the threshold; the Accountant confirms",
    async () => {
      const roll = run.books.rolls.find((candidate) => candidate.rollNumber === rollNumber(run, 1))!;
      i8 = await rollInvoice(run, roll.id, c1, "30");
      const p = await recordPayment(run, i8.id, i8.total, "ach", "owner");
      await reviewPayment(run, p, true);
    },
  );
  await run.step("I8's roll is cut at the roll's own cost", async () => {
    await issueStock(run, i8!.id);
  });
  await run.step("checks move from Operating to Reserve", async () => {
    await moveMethod(run, "check", "Reserve");
  });
  await run.step(
    "I9: C3 buys 100 sq ft, paid by check into Reserve; P1, an earlier check, is voided back to Operating",
    async () => {
      const i9 = await quotedInvoice(run, c3, [tileLine(tile, tileCartons(5))]);
      await recordPayment(run, i9.id, i9.total, "check", "owner");
      if (paymentNow(run, p1).status !== "confirmed") run.fail("P1 should still be confirmed.");
      await voidPayment(run, p1);
    },
  );
  await run.step("E1: supplies 200.00 plus 15.00 tax, paid in cash", async () => {
    await recordExpense(run, {
      supplierId: cast.suppliers.services,
      category: "supplies",
      locationId: denver,
      amount: "200.00",
      tax: "15.00",
      paymentMethod: "cash",
      settlement: "paid",
    });
  });
  await run.step(
    "E2: maintenance 1,100.00 plus 80.00 tax on account, above the expense threshold; the Owner approves",
    async () => {
      const e2 = await recordExpense(run, {
        supplierId: cast.suppliers.services,
        category: "maintenance",
        locationId: null,
        amount: "1100.00",
        tax: "80.00",
        paymentMethod: "ach",
        settlement: "on_account",
      });
      await reviewExpense(run, e2.id, true);
    },
  );
  await run.step("E1 is voided", async () => {
    const e1 = run.books.expenses.find((e) => e.category === "supplies" && e.status === "confirmed")!;
    await voidExpense(run, e1.id);
  });
  await run.step("a sales tax payment of 50.00 by ACH", async () => {
    await recordExpense(run, {
      supplierId: cast.suppliers.government,
      category: "sales_tax_payment",
      locationId: null,
      amount: "50.00",
      tax: "",
      paymentMethod: "ach",
      settlement: "paid",
    });
  });
  await run.step("a count finds 2 cartons (40 sq ft) of tile missing at the Denver warehouse", async () => {
    await correctStock(run, tile, denver, dec(tileCartons(2)).negated().toString());
  });
  return cast;
}

/** PO1, drafted and then placed: 400 sq ft of tile at the tile's cost and 1,200 sq ft of carpet at the carpet's. */
async function purchaseOrderStep(run: MoneyRun, cast: MoneyCast) {
  let order: Awaited<ReturnType<typeof purchaseOrder>> | undefined;
  await run.step("PO1: drafted, then placed: 400 sq ft of tile and 1,200 sq ft of carpet", async () => {
    order = await purchaseOrder(
      run,
      cast.suppliers.goods,
      run.places.warehouses[0],
      [
        { productId: run.places.tile, description: "Slate Tile", quantity: "400", unitCost: TILE.cost },
        {
          productId: run.places.carpet,
          description: "Harbor Carpet",
          quantity: carpetArea("100"),
          unitCost: CARPET.cost,
        },
      ],
      true,
    );
  });
  return order!;
}
