import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  adjustmentNeedsApproval,
  availability,
  boxedOnHand,
  dec,
  mayIssue,
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
const boxed = summit.products.find((p) => stockUnit(p) === "cartons")!;
const at = summit.rolls.find((r) => r.productId === carpet.id && !r.transferId)!.locationId;
const stock = { rolls: summit.rolls, movements: summit.stockMovements, reservations: [] as Reservation[] };
const line = (id: string, productId: string, unit: "sq_yd" | "carton", quantity: string) =>
  ({ id, productId, unit, quantity, description: id, category: "material", unitPrice: "1", unitCost: "1" }) as const;
const invoice = (lines: Invoice["lines"]) => ({ id: "inv-x", locationId: at, lines }) as Invoice;

describe("reservations (spec C2)", () => {
  it("turns sq yd of carpet into ft of roll length, and cartons into cartons", () => {
    expect(stockNeed({ quantity: "40", unit: "sq_yd" }, { ...carpet, widthFt: 12 })?.toString()).toBe("30");
    expect(stockNeed({ quantity: "7", unit: "carton" }, boxed)?.toString()).toBe("7");
  });

  it("holds one roll when one is long enough, and never more than is free", () => {
    const [r] = planReservations(invoice([line("a", carpet.id, "sq_yd", "4")]), summit.products, stock);
    expect(r).toMatchObject({ shortBy: "0", status: "active" });
    const roll = summit.rolls.find((x) => x.id === r!.rollId)!;
    expect(dec(r!.quantity).lte(roll.remainingLengthFt)).toBe(true);
  });

  it("spreads a long line over several rolls, and records what no roll can cover", () => {
    const free = summit.rolls
      .filter((r) => r.productId === carpet.id && r.locationId === at && !r.transferId)
      .reduce((s, r) => s.plus(rollAvailable(r, [])), dec(0));
    const sqYd = free.plus(30).times(carpet.widthFt!).div(9).toDecimalPlaces(0, 0).toString();
    const drafts = planReservations(invoice([line("b", carpet.id, "sq_yd", sqYd)]), summit.products, stock);
    const held = drafts.reduce((s, d) => s.plus(d.quantity), dec(0));
    expect(held.toString()).toBe(free.toString());
    expect(drafts.at(-1)).toMatchObject({ rollId: null, quantity: "0" });
    expect(dec(drafts.at(-1)!.shortBy).gt(0)).toBe(true);
  });

  it("holds boxed goods up to what is available at the warehouse", () => {
    const onHand = boxedOnHand(summit.stockMovements, boxed.id, at);
    const [r] = planReservations(
      invoice([line("c", boxed.id, "carton", onHand.plus(5).toString())]),
      summit.products,
      stock,
    );
    expect(r).toMatchObject({ quantity: onHand.toString(), shortBy: "5" });
  });

  it("lets stock leave only after confirmed money, and asks approval above the limit", () => {
    expect(mayIssue({ paid: "0.00", state: "open" })).toBe(false);
    expect(mayIssue({ paid: "50.00", state: "partial" })).toBe(true);
    expect(adjustmentNeedsApproval("-60", "50")).toBe(true);
    expect(adjustmentNeedsApproval("-20", "50")).toBe(false);
    expect(adjustmentNeedsApproval("-500", "")).toBe(false);
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
