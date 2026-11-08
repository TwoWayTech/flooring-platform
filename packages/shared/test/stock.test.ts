import { describe, expect, it } from "vitest";
import {
  boxedOnHand,
  defaultWarehouse,
  receiveTransfer,
  startTransfer,
  validateTransfer,
  type Location,
  type Roll,
  type StockMovement,
  type Transfer,
} from "../src";

const address = { street: "1 Test Way", city: "Denver", state: "CO", zip: "80202" };
const loc = (id: string, kind: Location["kind"], isDefault = false): Location => ({
  id,
  name: id.toUpperCase(),
  kind,
  branchId: "b1",
  address,
  isDefault,
  displaySamples: 0,
});
const locations = [loc("w1", "warehouse"), loc("w2", "warehouse", true), loc("s1", "showroom")];
const movement = (locationId: string, quantity: string): StockMovement => ({
  id: `${locationId}-${quantity}`,
  at: "2026-11-01T08:00",
  productId: "p1",
  locationId,
  quantity,
  kind: "opening",
  source: { kind: "count", id: "c", number: "Stock count" },
  byUserId: null,
});
const movements = [movement("w1", "30"), movement("w2", "12"), movement("w1", "-5")];
const roll = { id: "r1", rollNumber: "NM-1", productId: "p2", locationId: "w1", transferId: null } as Roll;
const ids = { movementId: () => "m", at: "2026-11-08T10:00", byUserId: "u1" };

describe("stock ledger (spec A1, C1)", () => {
  it("sums movements per warehouse and across warehouses", () => {
    expect(boxedOnHand(movements, "p1", "w1").toString()).toBe("25");
    expect(boxedOnHand(movements, "p1").toString()).toBe("37");
  });

  it("starts documents from the person's warehouse, then the company default", () => {
    expect(defaultWarehouse(locations, { defaultLocationId: "w1" })?.id).toBe("w1");
    expect(defaultWarehouse(locations, { defaultLocationId: "s1" })?.id).toBe("w2");
    expect(defaultWarehouse(locations, null)?.id).toBe("w2");
  });
});

describe("transfers (spec A1)", () => {
  const input = { fromId: "w1", toId: "w2", note: "", lines: [{ productId: "p1", rollId: null, quantity: "10" }] };

  it("refuses showrooms, the same warehouse twice, and more than the sender holds", () => {
    expect(validateTransfer({ ...input, toId: "s1" }, locations, [roll], movements)).toBe(
      "Showrooms hold no sellable stock.",
    );
    expect(validateTransfer({ ...input, toId: "w1" }, locations, [roll], movements)).toBe(
      "Choose two different warehouses.",
    );
    const tooMany = { ...input, lines: [{ productId: "p1", rollId: null, quantity: "26" }] };
    expect(validateTransfer(tooMany, locations, [roll], movements)).toMatch(/Only 25 on hand/);
    expect(validateTransfer(input, locations, [roll], movements)).toBeNull();
  });

  it("refuses a roll that is already travelling", () => {
    const lines = [{ productId: "p2", rollId: "r1", quantity: "90" }];
    expect(validateTransfer({ ...input, lines }, locations, [{ ...roll, transferId: "t0" }], movements)).toMatch(
      /already on a transfer/,
    );
  });

  it("takes stock out when sent and puts it in when received; the roll moves whole", () => {
    const transfer: Transfer = {
      id: "t1",
      number: "TR-0001",
      fromId: "w1",
      toId: "w2",
      status: "in_transit",
      createdAt: ids.at,
      createdBy: "u1",
      receivedAt: null,
      receivedBy: null,
      note: "",
      lines: [
        { id: "l1", productId: "p1", rollId: null, quantity: "10" },
        { id: "l2", productId: "p2", rollId: "r1", quantity: "90" },
      ],
    };
    const sent = startTransfer(transfer, [roll], ids);
    expect(sent.movements).toEqual([
      expect.objectContaining({ locationId: "w1", quantity: "-10", kind: "transfer_out" }),
    ]);
    expect(sent.rolls).toEqual([expect.objectContaining({ id: "r1", transferId: "t1", locationId: "w1" })]);
    const received = receiveTransfer(transfer, sent.rolls, ids);
    expect(received.transfer.status).toBe("received");
    expect(received.movements).toEqual([
      expect.objectContaining({ locationId: "w2", quantity: "10", kind: "transfer_in" }),
    ]);
    expect(received.rolls).toEqual([expect.objectContaining({ locationId: "w2", transferId: null, bin: "Receiving" })]);
    expect(() => receiveTransfer(received.transfer, [], ids)).toThrow();
  });
});
