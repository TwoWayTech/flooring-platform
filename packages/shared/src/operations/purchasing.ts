import { dec, moneyString, roundMoney, roundUnitCost, sum } from "../money";
import { isBoxed } from "../stock";
import type { Bill, PoLine, Product, PurchaseOrder, Roll, StockMovement, Supplier } from "../types";
import { SQ_FT_PER_SQ_YD } from "../units";
import { dueDate } from "./quotes";

/** Total of purchase order lines: quantity × unit cost, each rounded to cents. */
export function poTotal(lines: readonly Pick<PoLine, "quantity" | "unitCost">[]): string {
  return moneyString(sum(lines.map((l) => roundMoney(dec(l.quantity).times(l.unitCost)))));
}

/** What receiving changes: the order, stock ledger lines for boxed goods, and new rolls for broadloom. */
export interface ReceiptResult {
  po: PurchaseOrder;
  movements: StockMovement[];
  rolls: Roll[];
}

/**
 * Receives a purchase order into its receive-into warehouse (spec "Suppliers and purchasing",
 * A1). Boxed goods add a receipt line to the stock ledger. Broadloom arrives as one roll per
 * line, its length in ft from the sq yd ordered and the roll width (CLAUDE.md rule 4), costed
 * per sq ft from the line's unit cost.
 */
export function receivePurchaseOrder(
  po: PurchaseOrder,
  products: readonly Product[],
  input: {
    at: string;
    byUserId: string;
    newRollId: (lineId: string) => string;
    rollNumber: (product: Product) => string;
    movementId: () => string;
  },
): ReceiptResult {
  if (po.status !== "sent" && po.status !== "draft") throw new Error(`${po.number} was already received.`);
  const movements: StockMovement[] = [];
  const rolls: Roll[] = [];
  for (const line of po.lines) {
    const product = products.find((p) => p.id === line.productId);
    if (!product) continue;
    if (product.unit === "sq_yd" && product.widthFt) {
      const lengthFt = dec(line.quantity)
        .times(SQ_FT_PER_SQ_YD)
        .dividedBy(product.widthFt)
        .toDecimalPlaces(1)
        .toString();
      rolls.push({
        id: input.newRollId(line.id),
        rollNumber: input.rollNumber(product),
        productId: product.id,
        dyeLot: `${po.number.slice(-3)}A`,
        widthFt: product.widthFt,
        originalLengthFt: lengthFt,
        remainingLengthFt: lengthFt,
        costPerSqFt: roundUnitCost(dec(line.unitCost).dividedBy(SQ_FT_PER_SQ_YD)).toString(),
        locationId: po.locationId,
        bin: "Receiving",
        transferId: null,
        isRemnant: false,
        parentRollId: null,
        receivedAt: input.at.slice(0, 10),
        cuts: [],
      });
    } else if (isBoxed(product)) {
      movements.push({
        id: input.movementId(),
        at: input.at,
        productId: product.id,
        locationId: po.locationId,
        quantity: dec(line.quantity).toString(),
        kind: "receipt",
        source: { kind: "receipt", id: po.id, number: po.number },
        byUserId: input.byUserId,
      });
    }
  }
  return { po: { ...po, status: "received", receivedAt: input.at.slice(0, 10) }, movements, rolls };
}

/** A supplier bill for a received purchase order, due under the supplier's terms. */
export function billFromPurchaseOrder(
  po: PurchaseOrder,
  supplier: Supplier,
  input: { id: string; number: string; issuedAt: string },
): Bill {
  if (po.status !== "received") throw new Error(`${po.number} must be received before it is billed.`);
  return {
    id: input.id,
    number: input.number,
    supplierId: supplier.id,
    poId: po.id,
    issuedAt: input.issuedAt,
    dueAt: dueDate(input.issuedAt, supplier.terms),
    total: po.total,
    paid: "0.00",
  };
}
