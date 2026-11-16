import { expect } from "@playwright/test";
import {
  dec,
  moneyString,
  receivedValue,
  type Bill,
  type GoodsReceipt,
  type Location,
  type Product,
  type PurchaseOrder,
  type Roll,
  type StockMovement,
  type Supplier,
  type SupplierContact,
  type SupplierPayment,
} from "@workspace/shared";
import { FLOW_TAG } from "../../e2e/helpers";
import { ACCOUNTANT_EMAIL, PURCHASING_EMAIL } from "../accounts";
import { cellUnder, expectAuditRows, expectLedgerMoved, expectOutboxSent, trialBalance } from "./checks";
import {
  addProduct,
  assertSameCompanyDay,
  choose,
  companyToday,
  CORK_LVP,
  FIELDSTONE,
  flowTest,
  PDF_PROOF,
  resetAuthAround,
  runId,
  shown,
  waitForAnswer,
} from "./kit";
import { CASH } from "./ledger";

/** Where the flow receives each line (demo flow G3-2): the roll at Springs keeps F1's Denver rolls as they were. */
const CARTONS_AT = "Denver Central";
const ROLL_AT = "Colorado Springs";

/** The id of the location the page listed under `name`. */
function locationId(locations: readonly Location[], name: string): string {
  const found = locations.find((location) => location.name === name);
  if (!found) throw new Error(`The page lists no location named ${name}.`);
  return found.id;
}

/**
 * Flow F2 (mirrors demo flow G3-2; session log 2026-11-16-0200, "The seven flows"): the buyer adds
 * a new supplier and its sales rep from inside a purchase order for a carton of LVP and a carpet
 * roll, places it (the order is emailed to the rep), and receives the cartons into Denver Central
 * and the roll into Colorado Springs; the accountant enters the supplier's bill and pays it. The
 * Outbox, the stock, the ledger after each posting and the audit log are checked from the answers
 * the screens got.
 */
flowTest.describe("flow F2: purchasing from a new supplier to its payment", () => {
  resetAuthAround([PURCHASING_EMAIL, ACCOUNTANT_EMAIL]);

  flowTest(
    "a new supplier and rep in an order, the order emailed, received into two warehouses, billed and paid",
    { tag: FLOW_TAG },
    async ({ personas }) => {
      flowTest.setTimeout(120_000);
      const run = runId();
      const start = companyToday();
      const since = Date.now();
      const supplierName = `E2E Flow Supply ${run}`;
      const repEmail = `e2e-flow-${run}@flows.example`;
      const rollNumber = `E2E-${run.toUpperCase()}`;
      const billNumber = `E2E-BILL-${run}`;
      const payReference = `E2E-F2-PAY-${run}`;
      const grace = await personas.open(ACCOUNTANT_EMAIL, { mfa: true });
      const renata = await personas.open(PURCHASING_EMAIL);

      const t0 = await flowTest.step("0. Grace's books before", () => trialBalance(grace.request));

      const { supplier, po } = await flowTest.step(
        "1. Renata adds the supplier and its rep inside a new order and places it",
        async () => {
          const { page } = renata;
          await page.goto("/purchasing?view=orders");
          await page.getByRole("button", { name: "New purchase order" }).click();
          const dialog = page.getByRole("dialog", { name: "New purchase order" });
          const picker = dialog.getByRole("combobox", { name: "Supplier" });
          await picker.click();
          await page.getByPlaceholder("Name, contact, phone or email").fill(supplierName);
          await page.getByRole("option", { name: `Add “${supplierName}” as a new supplier` }).click();
          const quick = page.getByRole("form", { name: "New supplier" });
          const added = waitForAnswer<Supplier>(page, "POST", /^\/api-proxy\/suppliers$/);
          await quick.getByRole("button", { name: "Add supplier" }).click();
          const made = await added;
          personas.onCleanup(`deactivate ${supplierName}`, () =>
            renata.request.post(`/api-proxy/suppliers/${made.id}/status`, { data: { status: "inactive" } }),
          );
          // The picker's popover must be gone before going on (STATUS: the flaky demo purchasing phone test).
          await expect(quick).toBeHidden();
          await expect(picker).toHaveText(supplierName);

          await dialog.getByRole("button", { name: "Add new contact" }).click();
          const rep = page.getByRole("dialog", { name: "Add contact" });
          await rep.getByLabel("Name", { exact: true }).fill("Sam Rivera");
          await rep.getByLabel("Email", { exact: true }).fill(repEmail);
          const savedRep = waitForAnswer<SupplierContact>(page, "POST", /^\/api-proxy\/supplier-contacts$/);
          await rep.getByRole("button", { name: "Save contact" }).click();
          const contact = await savedRep;
          await expect(rep).toBeHidden();
          await expect(dialog.getByLabel("Sales rep", { exact: true })).toContainText("Sam Rivera");

          await addProduct(page, CORK_LVP);
          const cartons = dialog.getByLabel(`${CORK_LVP.line} area in sq ft`, { exact: true });
          await cartons.fill("1c");
          await cartons.blur();
          await expect(cartons).toHaveValue("28.5");
          await addProduct(page, FIELDSTONE);
          const area = dialog.getByLabel(`${FIELDSTONE.line} area in sq ft`, { exact: true });
          await area.fill("150");
          await area.blur();

          const drafted = waitForAnswer<PurchaseOrder>(page, "POST", /^\/api-proxy\/purchase-orders$/);
          await dialog.getByRole("button", { name: "Save as draft" }).click();
          const draft = await drafted;
          personas.onCleanup(`cancel ${draft.number}`, () =>
            renata.request.post(`/api-proxy/purchase-orders/${draft.id}/cancel`, {
              data: { reason: "e2e flow clean-up" },
            }),
          );
          await expect(page.getByText(`Draft ${draft.number} saved`, { exact: true })).toBeVisible();
          expect(draft.supplierId).toBe(made.id);
          expect(draft.contactId, "Sam Rivera is the order's sales rep").toBe(contact.id);

          await page.getByPlaceholder("Search purchase orders").fill(draft.number);
          await page.getByRole("row", { name: `Open ${draft.number}`, exact: true }).click();
          const drawer = page.getByRole("dialog", { name: new RegExp(`^${draft.number}`) });
          const ordered = waitForAnswer<PurchaseOrder>(
            page,
            "POST",
            new RegExp(`^/api-proxy/purchase-orders/${draft.id}/order$`),
          );
          await drawer.getByRole("button", { name: "Place order" }).click();
          const placed = await ordered;
          expect(placed.status).toBe("ordered");
          expect(placed.placedVia, "the rep has an email, so the order is emailed").toBe("email");
          await expect(page.getByText(`${draft.number} ordered`, { exact: true })).toBeVisible();
          return { supplier: made, po: placed };
        },
      );

      await flowTest.step("1. the order goes to the rep by email (Outbox)", async () => {
        const rows = await expectOutboxSent(
          renata.request,
          (row) => row.eventKey === "po.sent" && row.sourceId === po.id,
        );
        expect(
          rows.map((row) => row.recipientEmail),
          "one email, to the rep",
        ).toEqual([repEmail]);
      });

      const receipt = await flowTest.step(
        `2. Renata receives the cartons into ${CARTONS_AT} and the roll into ${ROLL_AT}`,
        async () => {
          const { page } = renata;
          const drawer = page.getByRole("dialog", { name: new RegExp(`^${po.number}`) });
          await drawer.getByRole("button", { name: "Receive", exact: true }).click();
          const receive = page.getByRole("dialog", { name: `Receive ${po.number}` });
          const cartons = receive.getByRole("group", { name: CORK_LVP.line, exact: true });
          await choose(page, cartons.getByLabel("Received into", { exact: true }), CARTONS_AT);
          const roll = receive.getByRole("group", { name: FIELDSTONE.line, exact: true });
          await choose(page, roll.getByLabel("Received into", { exact: true }), ROLL_AT);
          await roll.getByRole("button", { name: "Add roll" }).click();
          await roll.getByLabel("Roll number", { exact: true }).fill(rollNumber);
          await roll.getByLabel("Dye lot", { exact: true }).fill("E2E");
          await roll.getByLabel("Length, ft", { exact: true }).fill("10");
          const recorded = waitForAnswer<GoodsReceipt>(
            page,
            "POST",
            new RegExp(`^/api-proxy/purchase-orders/${po.id}/receipts$`),
          );
          await receive.getByRole("button", { name: "Record receipt" }).click();
          const saved = await recorded;
          await expect(receive).toBeHidden();
          await expect(page.getByText(`${saved.number} recorded for ${po.number}`, { exact: true })).toBeVisible();
          return saved;
        },
      );

      await flowTest.step("2. the stock: the roll at Springs, the cartons at Denver", async () => {
        const { page } = renata;
        const rollsAnswer = waitForAnswer<Roll[]>(page, "GET", /^\/api-proxy\/rolls$/);
        const movesAnswer = waitForAnswer<StockMovement[]>(page, "GET", /^\/api-proxy\/stock-movements$/);
        const productsAnswer = waitForAnswer<Product[]>(page, "GET", /^\/api-proxy\/products$/);
        const placesAnswer = waitForAnswer<Location[]>(page, "GET", /^\/api-proxy\/locations$/);
        await page.goto("/inventory?view=rolls");
        const [rolls, moves, products, places] = await Promise.all([
          rollsAnswer,
          movesAnswer,
          productsAnswer,
          placesAnswer,
        ]);
        const received = rolls.filter((r) => r.rollNumber === rollNumber);
        expect(
          received.map((r) => ({ at: r.locationId, ft: dec(r.remainingLengthFt).toString() })),
          `roll ${rollNumber}: 10 ft at ${ROLL_AT}`,
        ).toEqual([{ at: locationId(places, ROLL_AT), ft: "10" }]);
        await page.getByPlaceholder("Search rolls, products, dye lots").fill(rollNumber);
        const row = page.getByRole("row", { name: `Open roll ${rollNumber}`, exact: true });
        const table = page.locator("table").filter({ has: row });
        await expect(await cellUnder(table, row, "Warehouse")).toHaveText(ROLL_AT);
        await expect(await cellUnder(table, row, "Remaining")).toHaveText(`${shown("10", "quantity")} ft`);

        // The cartons are a stock movement, matched to the product by the name the page was given.
        const lvp = products.find((p) => `${p.brand} ${p.name}` === CORK_LVP.line);
        if (!lvp) throw new Error(`The page lists no product named ${CORK_LVP.line}.`);
        const cartons = moves.filter((m) => m.source.id === receipt.id && m.productId === lvp.id);
        expect(
          cartons.map((m) => ({ kind: m.kind, at: m.locationId, sqFt: dec(m.quantity).toString() })),
          `one carton (28.5 sq ft) of ${CORK_LVP.line} into ${CARTONS_AT}`,
        ).toEqual([{ kind: "receipt", at: locationId(places, CARTONS_AT), sqFt: "28.5" }]);
      });

      // What was received is worth the order's costs (purchasing rule 19), from the answers.
      const received = moneyString(receivedValue(po, [receipt]));
      const t1 = await flowTest.step("2. the ledger: stock up, owed to the supplier until the bill comes", async () => {
        expect(dec(received).gt(0), "the order carries its line costs, so the receipt has a value").toBe(true);
        const tb = await trialBalance(grace.request);
        expectLedgerMoved(t0, tb, { inventory: received, received_not_billed: dec(received).negated() });
        return tb;
      });

      const bill = await flowTest.step("3. Grace enters the supplier's bill for the order", async () => {
        const { page } = grace;
        await page.goto("/purchasing?view=orders");
        await page.getByPlaceholder("Search purchase orders").fill(po.number);
        await page.getByRole("row", { name: `Open ${po.number}`, exact: true }).click();
        await page
          .getByRole("dialog", { name: new RegExp(`^${po.number}`) })
          .getByRole("button", { name: "Enter bill" })
          .click();
        const dialog = page.getByRole("dialog", { name: `Enter bill for ${po.number}` });
        await dialog.getByLabel("Supplier's bill number").fill(billNumber);
        await expect(dialog.getByLabel("Bill total"), "the total starts at the received value").toHaveValue(received);
        await dialog.locator('input[type="file"]').setInputFiles(PDF_PROOF);
        const entered = waitForAnswer<Bill>(page, "POST", new RegExp(`^/api-proxy/purchase-orders/${po.id}/bills$`));
        await dialog.getByRole("button", { name: "Enter bill" }).click();
        const saved = await entered;
        await expect(dialog).toBeHidden();
        await expect(page.getByText(`Bill ${billNumber} entered`, { exact: true })).toBeVisible();
        expect(saved.matchIssues, "the bill matches the goods received").toEqual([]);
        return saved;
      });

      const t2 = await flowTest.step("3. the ledger: the bill moves what was received to payables", async () => {
        const tb = await trialBalance(grace.request);
        // A total other than the received value is a price difference on goods in stock (stock-postings.ts).
        expectLedgerMoved(t1, tb, {
          received_not_billed: received,
          accounts_payable: dec(bill.total).negated(),
          inventory: dec(bill.total).minus(received),
        });
        return tb;
      });

      await flowTest.step("4. Grace pays the bill", async () => {
        const { page } = grace;
        await page.goto("/purchasing?view=bills");
        await page.getByPlaceholder("Search bills").fill(billNumber);
        await page
          .getByRole("row", { name: `Open bill ${billNumber}`, exact: true })
          .getByRole("button", { name: "Pay" })
          .click();
        const sheet = page.getByRole("dialog", { name: `Pay ${supplierName}` });
        await expect(sheet.getByLabel("Amount", { exact: true })).toHaveValue(bill.total);
        await sheet.getByLabel("Reference or transaction ID").fill(payReference);
        await sheet.locator('input[type="file"]').setInputFiles(PDF_PROOF);
        const recorded = waitForAnswer<SupplierPayment>(page, "POST", /^\/api-proxy\/supplier-payments$/);
        await sheet.getByRole("button", { name: "Save payment" }).click();
        const saved = await recorded;
        await expect(sheet).toBeHidden();
        expect(
          saved.status,
          "a supplier payment under Summit's approval threshold counts when recorded; a changed local threshold holds it",
        ).toBe("confirmed");
        await expect(page.getByText(`${saved.number} recorded`, { exact: true })).toBeVisible();
      });

      await flowTest.step("4. the ledger: payables down and cash out by the bill, and the whole flow", async () => {
        const t3 = await trialBalance(grace.request);
        expectLedgerMoved(t2, t3, { accounts_payable: bill.total, [CASH]: dec(bill.total).negated() });
        expectLedgerMoved(t0, t3, { inventory: bill.total, [CASH]: dec(bill.total).negated() });
      });

      await flowTest.step("5. the audit log", async () => {
        await expectAuditRows(
          grace.page,
          po.number,
          ["Saved purchase order draft", "Ordered purchase order", "Received goods", "Entered bill"],
          since,
        );
        await expectAuditRows(
          grace.page,
          supplierName,
          ["Added supplier from a purchase order", "Added supplier contact", "Paid supplier"],
          since,
        );
      });

      await flowTest.step("6. the supplier stays active: a placed order keeps it so (purchasing.md)", async () => {
        const { page } = renata;
        await page.goto("/purchasing?view=suppliers");
        await page.getByPlaceholder("Search suppliers").fill(supplierName);
        await page.getByRole("row", { name: `Open ${supplierName}`, exact: true }).click();
        const drawer = page.getByRole("dialog", { name: new RegExp(`^${supplierName}`) });
        const refused = page.waitForResponse(
          (r) => r.request().method() === "POST" && r.url().endsWith(`/api-proxy/suppliers/${supplier.id}/status`),
        );
        await drawer.getByRole("button", { name: "Deactivate", exact: true }).click();
        expect(
          (await refused).status(),
          "purchasing.md edge case: an order's stored status stays ordered once placed, so its supplier stays active",
        ).toBe(409);
        await expect(page.getByText(`${supplierName} has an open order, so it stays active.`)).toBeVisible();
      });
      assertSameCompanyDay(start);
    },
  );
});
