import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { reservations, rollCuts, rolls, stockMovements } from "@workspace/db/company";
import {
  boxedOnHand,
  costOfGoodsPosting,
  cutRoll,
  dec,
  featureOn,
  mayIssue,
  moneyString,
  stockIssueAction,
  validateCut,
  type Reservation,
} from "@workspace/shared";
import { and, eq, ne } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import { v7 as uuidv7 } from "uuid";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { LedgerService } from "../../core/ledger/ledger.service";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { invoiceState, lockCustomer } from "../sales/invoice-ledger";
import { loadInvoices, loadReservations } from "../sales/invoice-records";
import { companyClock, seesDocument } from "../sales/sales-common";
import { loadCustomers } from "../sales/sales-records";
import { loadMovements, loadProducts, loadRolls } from "./inventory-records";
import { lockStock } from "./stock-lock";

/** One open hold with just enough of its invoice to cut against it (inventory rule 14; audit U-03). */
export interface StockHold {
  reservationId: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  mayIssue: boolean;
  productId: string;
  rollId: string | null;
  locationId: string;
  quantity: string;
  shortBy: string;
}

function refuse(message: string): BadRequestException {
  return new BadRequestException({ code: "invalid_request", message });
}

/**
 * Stock leaving for a sale (inventory rules 13 to 17; inventory part 2; ADR 0043): a hold is cut
 * from its roll or issued from the warehouse once confirmed money is in, or before that with an
 * override and a reason. The cost of the goods posts at once (ADR 0042), at the roll's own cost
 * per sq ft or the product's average cost.
 */
@Injectable()
export class StockIssueService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly books: LedgerService,
  ) {}

  /**
   * Every active hold with its invoice number, customer name and whether it may leave (rule 14).
   * Warehouse staff see these three facts of the invoice and nothing else of sales. Anyone else
   * sees them only for invoices in their data scope; otherwise the hold shows the stock alone, as
   * the reservations list does (PR #15 and PR #22 reviews).
   */
  async holds(tenant: TenantContext, access: RequestAccess): Promise<StockHold[]> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const active = (await loadReservations(db)).filter((reservation) => reservation.status === "active");
    if (active.length === 0) return [];
    const invoiceIds = [...new Set(active.map((reservation) => reservation.invoiceId))];
    const invoiceRows = await loadInvoices(db, clock.zone, { ids: invoiceIds });
    const customers = await loadCustomers(db, [...new Set(invoiceRows.map((invoice) => invoice.customerId))]);
    const states = new Map<string, boolean>();
    for (const invoice of invoiceRows) {
      states.set(invoice.id, mayIssue((await invoiceState(db, this.control.db, invoice.id, clock)).ledger));
    }
    // With rolls switched off, roll holds are hidden too (CLAUDE.md rule 13).
    const rollsOn = featureOn("inventory.rolls");
    return active.flatMap((reservation) => {
      if (reservation.rollId && !rollsOn) return [];
      const invoice = invoiceRows.find((candidate) => candidate.id === reservation.invoiceId);
      if (!invoice || invoice.voidedAt) return [];
      if (!access.permissions.has("inventory.roll.cut") && !seesDocument(access, invoice)) {
        return [
          {
            reservationId: reservation.id,
            invoiceId: "",
            invoiceNumber: "",
            customerName: "",
            mayIssue: false,
            productId: reservation.productId,
            rollId: reservation.rollId,
            locationId: reservation.locationId,
            quantity: reservation.quantity,
            shortBy: reservation.shortBy,
          },
        ];
      }
      return [
        {
          reservationId: reservation.id,
          invoiceId: invoice.id,
          invoiceNumber: invoice.number,
          customerName: customers.find((customer) => customer.id === invoice.customerId)?.name ?? "",
          mayIssue: states.get(invoice.id) ?? false,
          productId: reservation.productId,
          rollId: reservation.rollId,
          locationId: reservation.locationId,
          quantity: reservation.quantity,
          shortBy: reservation.shortBy,
        },
      ];
    });
  }

  /**
   * Cuts or issues one hold (rules 13, 15 to 17). The customer and stock locks are taken in that
   * order, as invoices take them, so the money read and the stock written can't move underneath.
   */
  async issue(
    tenant: TenantContext,
    actor: Actor,
    reservationId: string,
    overrideReason?: string,
  ): Promise<Reservation> {
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    const [found] = (await loadReservations(db)).filter((reservation) => reservation.id === reservationId);
    if (!found) throw new NotFoundException({ code: "not_found", message: "This reservation no longer exists." });
    const [owner] = await loadInvoices(db, clock.zone, { ids: [found.invoiceId] });
    if (!owner) throw new NotFoundException({ code: "not_found", message: "This reservation no longer exists." });
    const override = overrideReason?.trim() ?? "";
    await db.transaction(async (tx) => {
      await lockCustomer(tx, owner.customerId);
      await lockStock(tx);
      const [reservation] = await tx
        .select()
        .from(reservations)
        .where(eq(reservations.id, reservationId))
        .for("update");
      if (!reservation || reservation.status !== "active") throw refuse("This reservation is no longer open.");
      if (dec(reservation.quantity).lte(0)) throw refuse("Nothing is reserved on this line; it is short.");
      const { invoice, ledger } = await invoiceState(tx, this.control.db, reservation.invoiceId, clock);
      if (invoice.voidedAt) throw refuse(`Invoice ${invoice.number} is void.`);
      const paidFor = mayIssue(ledger);
      if (!paidFor) {
        if (override.length < 3) {
          throw refuse(`Invoice ${invoice.number} has no confirmed payment yet. Record the deposit first.`);
        }
        if (!actor.access.permissions.has("inventory.reservation.override")) {
          throw new ForbiddenException({
            code: "forbidden",
            message: "Only someone allowed to override may issue stock before payment.",
          });
        }
      }
      const now = new Date();
      const source = { sourceType: "invoice" as const, sourceId: invoice.id, sourceNumber: invoice.number };
      let cost: ReturnType<typeof dec>;
      let summary: string;
      let warehouseId = reservation.locationId;
      let remnantHolds = 0;
      let cutRollNumber: string | null = null;
      if (reservation.rollId) {
        const [roll] = await loadRolls(tx, [reservation.rollId]);
        if (!roll) throw refuse("This roll no longer exists.");
        if (roll.transferId) throw refuse(`Roll ${roll.rollNumber} is on a transfer; receive it first.`);
        if (!featureOn("inventory.rolls")) throw new NotFoundException();
        const problem = validateCut(roll, reservation.quantity);
        if (problem) throw refuse(problem);
        const result = cutRoll(
          roll,
          {
            lengthFt: reservation.quantity,
            at: now.toISOString(),
            reference: invoice.number,
            byUserId: actor.access.userId,
          },
          { cutId: uuidv7(), remnantId: uuidv7() },
        );
        await tx
          .update(rolls)
          .set({ remainingLengthFt: result.roll.remainingLengthFt, updatedAt: now })
          .where(eq(rolls.id, roll.id));
        await tx.insert(rollCuts).values({
          rollId: roll.id,
          at: now,
          lengthFt: dec(reservation.quantity).toString(),
          reference: invoice.number,
          byUserId: actor.access.userId,
          ...source,
          createdBy: actor.access.userId,
        });
        if (result.remnant) {
          await tx.insert(rolls).values({
            id: result.remnant.id,
            rollNumber: result.remnant.rollNumber,
            productId: result.remnant.productId,
            dyeLot: result.remnant.dyeLot,
            widthFt: String(result.remnant.widthFt),
            originalLengthFt: result.remnant.originalLengthFt,
            remainingLengthFt: result.remnant.remainingLengthFt,
            costPerSqFt: result.remnant.costPerSqFt,
            locationId: result.remnant.locationId,
            bin: result.remnant.bin,
            isRemnant: true,
            parentRollId: roll.id,
            receivedAt: now,
            createdBy: actor.access.userId,
          });
        }
        if (result.remnant) {
          // The parent is used up; its other holds now sit on the remnant, so the leftover is never
          // promised twice (inventory rules 17 and 18; PR #22 review).
          const moved = await tx
            .update(reservations)
            .set({ rollId: result.remnant.id, updatedAt: now })
            .where(
              and(
                eq(reservations.rollId, roll.id),
                eq(reservations.status, "active"),
                ne(reservations.id, reservationId),
              ),
            )
            .returning({ id: reservations.id });
          remnantHolds = moved.length;
        }
        warehouseId = roll.locationId;
        cutRollNumber = roll.rollNumber;
        // What left the roll at its own cost: the cut, and a leftover under 12 ft that became a remnant stays stock.
        cost = dec(reservation.quantity).times(roll.widthFt).times(roll.costPerSqFt);
        summary = `cut ${reservation.quantity} ft from ${roll.rollNumber}${result.remnant ? `, remnant ${result.remnant.rollNumber}` : ""}`;
      } else {
        const product = (await loadProducts(tx)).find((candidate) => candidate.id === reservation.productId);
        if (!product) throw refuse("This product no longer exists.");
        // A transfer or a count may have taken the held stock since; never issue below zero.
        const onHand = boxedOnHand(await loadMovements(tx), product.id, reservation.locationId);
        if (onHand.lt(reservation.quantity)) {
          throw refuse(`Only ${onHand.toString()} of ${product.name} is on hand at this warehouse.`);
        }
        await tx.insert(stockMovements).values({
          at: now,
          productId: reservation.productId,
          locationId: reservation.locationId,
          quantity: dec(reservation.quantity).negated().toString(),
          kind: "issue",
          ...source,
          byUserId: actor.access.userId,
          createdBy: actor.access.userId,
        });
        cost = dec(reservation.quantity).times(product.cost);
        summary = `issued ${reservation.quantity}`;
      }
      await tx
        .update(reservations)
        .set({ status: "issued", closedAt: now, overrideReason: paidFor ? null : override, updatedAt: now })
        .where(eq(reservations.id, reservationId));
      await this.books.post(
        tx,
        costOfGoodsPosting(
          {
            id: reservationId,
            number: invoice.number,
            date: clock.day,
            warehouseId,
            soldAtId: invoice.soldAtLocationId ?? invoice.locationId,
            memo: `Cost of goods for ${invoice.number}: ${summary}`,
          },
          moneyString(cost),
        ),
        actor.access.userId,
      );
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: stockIssueAction(paidFor, invoice.number, cutRollNumber),
          targetType: "reservation",
          targetId: reservationId,
          targetLabel: invoice.number,
          before: { status: "active" },
          after: paidFor ? { issued: summary, remnantHolds } : { issued: summary, remnantHolds, override },
        },
        tx,
      );
    });
    const [issued] = (await loadReservations(db)).filter((reservation) => reservation.id === reservationId);
    return issued!;
  }
}
