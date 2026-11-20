import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adjustmentNeedsApproval,
  availability,
  boxedOnHand,
  dec,
  availableToSell,
  isShort,
  mayIssue,
  stockAcrossWarehouses,
  planReservations,
  rollAvailable,
  stockNeed,
  stockUnit,
  type CompanyFixtures,
  type Invoice,
  type Reservation,
} from "../src";

const load = (name: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../fixtures/${name}.json`, import.meta.url)), "utf8"),
  ) as CompanyFixtures;
const summit = load("summit");
const keystone = load("keystone");
const carpet = summit.products.find((p) => stockUnit(p) === "ft" && p.widthFt)!;
const boxed = summit.products.find((p) => stockUnit(p) === "sq_ft")!;
const at = summit.rolls.find((r) => r.productId === carpet.id && !r.transferId)!.locationId;
const stock = { rolls: summit.rolls, movements: summit.stockMovements, reservations: [] as Reservation[] };
const line = (id: string, productId: string, unit: "sq_ft", quantity: string) =>
  ({ id, productId, unit, quantity, description: id, category: "material", unitPrice: "1", unitCost: "1" }) as const;
const invoice = (lines: Invoice["lines"]) => ({ id: "inv-x", locationId: at, lines }) as Invoice;

describe("reservations (spec C2)", () => {
  it("turns sq ft of carpet into ft of roll length, and keeps boxed goods in sq ft", () => {
    expect(stockNeed({ quantity: "360", unit: "sq_ft" }, { ...carpet, widthFt: "12" })?.toString()).toBe("30");
    expect(stockNeed({ quantity: "168", unit: "sq_ft" }, boxed)?.toString()).toBe("168");
  });

  it("holds one roll when one is long enough, and never more than is free", () => {
    const [r] = planReservations(invoice([line("a", carpet.id, "sq_ft", "36")]), summit.products, stock);
    expect(r).toMatchObject({ shortBy: "0", status: "active" });
    const roll = summit.rolls.find((x) => x.id === r!.rollId)!;
    expect(dec(r!.quantity).lte(roll.remainingLengthFt)).toBe(true);
  });

  it("spreads a long line over several rolls, and records what no roll can cover", () => {
    const free = summit.rolls
      .filter((r) => r.productId === carpet.id && r.locationId === at && !r.transferId)
      .reduce((s, r) => s.plus(rollAvailable(r, [])), dec(0));
    const sqFt = free.plus(30).times(carpet.widthFt!).toString();
    const drafts = planReservations(invoice([line("b", carpet.id, "sq_ft", sqFt)]), summit.products, stock);
    const held = drafts.reduce((s, d) => s.plus(d.quantity), dec(0));
    expect(held.toString()).toBe(free.toString());
    expect(drafts.at(-1)).toMatchObject({ rollId: null, quantity: "0" });
    expect(dec(drafts.at(-1)!.shortBy).gt(0)).toBe(true);
  });

  it("holds boxed goods up to what is available at the warehouse", () => {
    const onHand = boxedOnHand(summit.stockMovements, boxed.id, at);
    const [r] = planReservations(
      invoice([line("c", boxed.id, "sq_ft", onHand.plus(5).toString())]),
      summit.products,
      stock,
    );
    expect(r).toMatchObject({ quantity: onHand.toString(), shortBy: "5" });
  });

  it("holds a line at its own warehouse when it was moved (spec A2)", () => {
    const other = summit.locations.find((l) => l.kind === "warehouse" && l.id !== at)!;
    const moved = { ...line("m", boxed.id, "sq_ft", boxed.sqFtPerCarton!), locationId: other.id };
    const [r] = planReservations(invoice([moved]), summit.products, stock);
    expect(r?.locationId).toBe(other.id);
  });

  it("says what a warehouse can promise, in sq ft, and ranks warehouses by it (spec A2)", () => {
    const area = availableToSell(carpet, stock, at)!;
    const expected = summit.rolls
      .filter((r) => r.productId === carpet.id && r.locationId === at && !r.transferId)
      .reduce((s, r) => s.plus(rollAvailable(r, []).times(r.widthFt)), dec(0));
    expect(area.toString()).toBe(expected.toString());
    expect(availableToSell(boxed, stock, at)!.toString()).toBe(
      boxedOnHand(summit.stockMovements, boxed.id, at).toString(),
    );
    const ranked = stockAcrossWarehouses(boxed, stock, summit.locations);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]!.available.gte(ranked[1]!.available)).toBe(true);
    const service = summit.products.find((p) => p.category === "service")!;
    expect(availableToSell(service, stock, at)).toBeNull();
  });

  it("lets stock leave only after confirmed money, and asks approval above the limit", () => {
    expect(mayIssue({ paid: "0.00", state: "open" })).toBe(false);
    expect(mayIssue({ paid: "50.00", state: "partial" })).toBe(true);
    expect(adjustmentNeedsApproval("-60", "50")).toBe(true);
    expect(adjustmentNeedsApproval("-20", "50")).toBe(false);
    expect(adjustmentNeedsApproval("-500", "")).toBe(false);
  });

  it("reads a shortfall by value, at any scale the API or the demo sends (STATUS B3)", () => {
    for (const shortBy of ["0", "0.00", "0.000"]) expect(isShort({ shortBy }), shortBy).toBe(false);
    for (const shortBy of ["0.001", "12.500", "158.4"]) expect(isShort({ shortBy }), shortBy).toBe(true);
  });

  for (const f of [summit, keystone]) {
    it(`${f.companyId}: seeded reservations never hold more than is on hand`, () => {
      const s = { rolls: f.rolls, movements: f.stockMovements, reservations: f.reservations };
      for (const roll of f.rolls)
        expect(
          dec(roll.remainingLengthFt).gte(rollAvailable(roll, []).minus(rollAvailable(roll, f.reservations))),
          roll.rollNumber,
        ).toBe(true);
      for (const p of f.products.filter((x) => stockUnit(x) && stockUnit(x) !== "ft")) {
        for (const l of f.locations) {
          const a = availability(p, s, l.id);
          expect(a.reserved.lte(a.onHand), `${p.sku} at ${l.id}`).toBe(true);
        }
      }
    });
  }
});
