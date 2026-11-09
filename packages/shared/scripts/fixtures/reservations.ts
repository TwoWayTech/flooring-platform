import { addDays } from "../../src/dates";
import { ledgerIndex } from "../../src/ledger";
import { dec } from "../../src/money";
import { planReservations } from "../../src/reservations";
import type { Invoice, Payment, Product, Reservation, Roll, StockMovement } from "../../src/types";

/** Open invoices from the last weeks still hold their stock; older ones were cut long ago. */
const RESERVE_DAYS = 21;

/**
 * Reservations for the open invoices of the last weeks (spec C2, Batch H): each stock line holds a
 * roll length or cartons at its warehouse, or records what is short. Drawn in issue order, so
 * earlier invoices get the stock first. No random numbers are used.
 */
export function buildReservations(
  newId: () => string,
  anchor: string,
  invoices: readonly Invoice[],
  payments: readonly Payment[],
  products: readonly Product[],
  stock: { rolls: readonly Roll[]; movements: readonly StockMovement[] },
): Reservation[] {
  const ledgers = ledgerIndex(invoices, { payments, adjustments: [] }, anchor);
  const recent = invoices
    .filter((i) => !i.isReturn && i.issuedAt >= addDays(anchor, -RESERVE_DAYS))
    .filter((i) => dec(ledgers.get(i.id)!.balance).gt(0))
    .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt));
  const reservations: Reservation[] = [];
  for (const invoice of recent) {
    for (const draft of planReservations(invoice, products, { ...stock, reservations })) {
      reservations.push({
        ...draft,
        id: newId(),
        createdAt: `${invoice.issuedAt}T09:00`,
      });
    }
  }
  return reservations;
}
