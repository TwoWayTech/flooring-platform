import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import { rollCuts, rolls, stockAdjustments, stockMovements, transferLines, transfers } from "@workspace/db/company";
import {
  moneyString,
  stockAdjustmentPosting,
  boxedOnHand,
  dec,
  isWholeCartons,
  nextNumber,
  nextPaymentNumber,
  receiveTransfer,
  startTransfer,
  stockUnit,
  validateTransfer,
  type Location,
  type Product,
  type Roll,
  type StockAdjustment,
  type StockMovement,
  type Transfer,
} from "@workspace/shared";
import { and, eq, isNull } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { LedgerService } from "../../core/ledger/ledger.service";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { companyClock } from "../sales/sales-common";
import { lockStock } from "./stock-lock";
import { loadLocations, loadMovements, loadProducts, loadRolls, loadTransfers } from "./inventory-records";

/** What starting a transfer carries (ApiClient `TransferInput`). */
export interface TransferInput {
  fromId: string;
  toId: string;
  lines: { productId: string; rollId: string | null; quantity: string }[];
  note: string;
}

/** What a stock correction carries (ApiClient `StockCorrectionInput`). */
export interface CorrectionInput {
  productId: string;
  rollId: string | null;
  locationId: string;
  counted: string;
  reason: string;
}

/** The first transfer number, as in the demo (`TR-1001`). */
const FIRST_TRANSFER = 1001;

/**
 * Inventory on the server, part 1 (docs/product-spec/inventory.md; ADR 0035): the catalog, rolls,
 * the boxed-stock ledger, warehouses and transfers, the Owner's stock correction and moving a roll
 * to another bin. Every stock change has a source document and an audit entry in the same
 * transaction; nothing edits stock freely. Reservations and the cut or issue move with sales.
 */
@Injectable()
export class InventoryService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly books: LedgerService,
  ) {}

  /** The catalog; cost is stripped later for anyone without `inventory.product.view_sensitive`. */
  async products(tenant: TenantContext): Promise<Product[]> {
    return loadProducts(await this.tenancy.db(tenant));
  }

  /** Every roll and remnant with its cuts. */
  async rolls(tenant: TenantContext): Promise<Roll[]> {
    return loadRolls(await this.tenancy.db(tenant));
  }

  /** The boxed-stock ledger. */
  async movements(tenant: TenantContext): Promise<StockMovement[]> {
    return loadMovements(await this.tenancy.db(tenant));
  }

  /** Warehouses and showrooms. */
  async locations(tenant: TenantContext): Promise<Location[]> {
    return loadLocations(await this.tenancy.db(tenant));
  }

  /** Transfers, newest first. */
  async transfers(tenant: TenantContext): Promise<Transfer[]> {
    return loadTransfers(await this.tenancy.db(tenant));
  }

  /**
   * Starts a transfer (spec "Transfer.status"): the shared rules check both warehouses, each roll
   * and each boxed quantity; boxed stock leaves the sender at once and rolls are marked in transit.
   */
  async createTransfer(tenant: TenantContext, actor: Actor, input: TransferInput): Promise<Transfer> {
    const db = await this.tenancy.db(tenant);
    const id = await db.transaction(async (tx) => {
      await lockStock(tx);
      const [locations, allRolls, movements, products, existing] = await Promise.all([
        loadLocations(tx),
        loadRolls(tx),
        loadMovements(tx),
        loadProducts(tx),
        tx.select({ number: transfers.number }).from(transfers),
      ]);
      const problem = validateTransfer(input, locations, allRolls, movements, products);
      if (problem) throw new BadRequestException({ code: "invalid_transfer", message: problem });
      // A roll travels whole: its line's length is the roll's, never what the client sent.
      const lengthOf = (rollId: string) => allRolls.find((roll) => roll.id === rollId)!.remainingLengthFt;
      const transfer: Transfer = {
        id: uuidv7(),
        number: nextNumber(
          "TR-",
          existing.map((row) => row.number),
          FIRST_TRANSFER,
        ),
        fromId: input.fromId,
        toId: input.toId,
        status: "in_transit",
        lines: input.lines.map((line) => ({
          ...line,
          quantity: line.rollId ? lengthOf(line.rollId) : line.quantity,
          id: uuidv7(),
        })),
        createdAt: new Date().toISOString(),
        createdBy: actor.access.userId,
        receivedAt: null,
        receivedBy: null,
        note: input.note.trim(),
      };
      await tx.insert(transfers).values({
        id: transfer.id,
        number: transfer.number,
        fromId: transfer.fromId,
        toId: transfer.toId,
        status: "in_transit",
        note: transfer.note,
        createdBy: actor.access.userId,
      });
      await tx.insert(transferLines).values(
        transfer.lines.map((line) => ({
          id: line.id,
          transferId: transfer.id,
          productId: line.productId,
          rollId: line.rollId,
          quantity: line.quantity,
          createdBy: actor.access.userId,
        })),
      );
      const sent = startTransfer(transfer, allRolls, this.ids(actor));
      await this.writeMovements(tx, sent.movements);
      for (const roll of sent.rolls)
        await tx.update(rolls).set({ transferId: transfer.id }).where(eq(rolls.id, roll.id));
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: "Started transfer",
          targetType: "transfer",
          targetId: transfer.id,
          targetLabel: transfer.number,
          after: {
            fromId: transfer.fromId,
            toId: transfer.toId,
            lines: transfer.lines.map(({ productId, rollId, quantity }) => ({ productId, rollId, quantity })),
          },
        },
        tx,
      );
      return transfer.id;
    });
    return (await loadTransfers(db, [id]))[0]!;
  }

  /** Receives a transfer at its destination; a second receipt is refused (spec "Transfer.status"). */
  async receiveTransfer(tenant: TenantContext, actor: Actor, transferId: string): Promise<Transfer> {
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      await lockStock(tx);
      const [transfer] = await loadTransfers(tx, [transferId]);
      if (!transfer) throw new NotFoundException({ code: "not_found", message: "This transfer no longer exists." });
      if (transfer.status !== "in_transit") {
        throw new ConflictException({ code: "already_received", message: `${transfer.number} was already received.` });
      }
      const received = receiveTransfer(transfer, await loadRolls(tx), this.ids(actor));
      await tx
        .update(transfers)
        .set({ status: "received", receivedAt: new Date(), receivedBy: actor.access.userId })
        .where(eq(transfers.id, transfer.id));
      await this.writeMovements(tx, received.movements);
      for (const roll of received.rolls) {
        await tx
          .update(rolls)
          .set({ locationId: roll.locationId, bin: roll.bin, transferId: null })
          .where(eq(rolls.id, roll.id));
      }
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: "Received transfer",
          targetType: "transfer",
          targetId: transfer.id,
          targetLabel: transfer.number,
          before: { status: "in_transit" },
          after: { status: "received", toId: transfer.toId },
        },
        tx,
      );
    });
    return (await loadTransfers(db, [transferId]))[0]!;
  }

  /** Moves a roll to another bin; nothing else about a roll can be edited (spec `assertRollEditOnly`). */
  async moveRoll(tenant: TenantContext, actor: Actor, rollId: string, bin: string): Promise<Roll> {
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select({ bin: rolls.bin, rollNumber: rolls.rollNumber })
        .from(rolls)
        .where(and(eq(rolls.id, rollId), isNull(rolls.deletedAt)));
      if (!before) throw new NotFoundException({ code: "not_found", message: "This roll no longer exists." });
      await tx.update(rolls).set({ bin: bin.trim() }).where(eq(rolls.id, rollId));
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: "Moved roll",
          targetType: "roll",
          targetId: rollId,
          targetLabel: `Roll ${before.rollNumber}`,
          before: { bin: before.bin },
          after: { bin: bin.trim() },
        },
        tx,
      );
    });
    return (await loadRolls(db, [rollId]))[0]!;
  }

  /**
   * Sets stock to what was counted, with a reason (spec "Correct stock count", plan A-1): an
   * approved count adjustment, applied as a roll cut or a ledger line. Boxed goods count in whole
   * cartons or items; a count equal to the books is refused.
   */
  async correctStock(tenant: TenantContext, actor: Actor, input: CorrectionInput): Promise<StockAdjustment> {
    const reason = input.reason.trim();
    if (reason.length < 3) throw refuse("Say why the count is being corrected.");
    const counted = dec(input.counted);
    if (counted.lt(0)) throw refuse("A count cannot be negative.");
    // Quantities are numeric(14,3): more decimals would be rounded silently by the database.
    if (counted.decimalPlaces() > 3 || counted.gte("1e10")) throw refuse("Count to at most 3 decimals.");
    const db = await this.tenancy.db(tenant);
    const clock = await companyClock(this.control.db, tenant);
    return db.transaction(async (tx) => {
      await lockStock(tx);
      const product = (await loadProducts(tx)).find((candidate) => candidate.id === input.productId);
      if (!product || !stockUnit(product)) throw refuse("This product is not stocked.");
      const roll = input.rollId ? (await loadRolls(tx, [input.rollId]))[0] : undefined;
      if (input.rollId && (!roll || roll.productId !== product.id)) throw refuse("This roll no longer exists.");
      if (roll?.transferId) throw refuse("This roll is in transit; count it after it is received.");
      // Carpet is counted roll by roll; boxed goods by warehouse, never in a showroom (plan A-1).
      if (stockUnit(product) === "ft" && !roll) throw refuse("Count carpet roll by roll.");
      if (stockUnit(product) !== "ft" && roll) throw refuse("This product is not kept on rolls.");
      if (!roll) {
        const locations = await loadLocations(tx);
        const location = locations.find((candidate) => candidate.id === input.locationId);
        if (location?.kind !== "warehouse") throw refuse("Choose a warehouse; showrooms hold no stock.");
        const pack = product.sqFtPerCarton;
        if (pack ? !isWholeCartons(counted, pack) : !counted.isInteger()) {
          throw refuse(pack ? `Count whole cartons: multiples of ${pack} sq ft.` : "Count whole items.");
        }
      }
      const before = roll
        ? dec(roll.remainingLengthFt)
        : boxedOnHand(await loadMovements(tx), product.id, input.locationId);
      const change = counted.minus(before);
      if (change.isZero()) throw refuse("That is what the books already say.");
      const numbers = await tx.select({ number: stockAdjustments.number }).from(stockAdjustments);
      const now = new Date();
      const adjustment: StockAdjustment = {
        id: uuidv7(),
        number: nextPaymentNumber(
          "ADJ-",
          numbers.map((row) => row.number),
        ),
        productId: product.id,
        rollId: roll?.id ?? null,
        locationId: roll?.locationId ?? input.locationId,
        quantity: change.toString(),
        reason: "count",
        note: reason,
        status: "approved",
        requestedById: actor.access.userId,
        requestedBy: actor.session.user.name,
        requestedAt: now.toISOString(),
        reviewedBy: actor.session.user.name,
        reviewedAt: now.toISOString(),
        rejectReason: null,
      };
      await tx.insert(stockAdjustments).values({
        id: adjustment.id,
        number: adjustment.number,
        productId: adjustment.productId,
        rollId: adjustment.rollId,
        locationId: adjustment.locationId,
        quantity: adjustment.quantity,
        reason: "count",
        note: reason,
        status: "approved",
        requestedById: actor.access.userId,
        requestedAt: now,
        reviewedById: actor.access.userId,
        reviewedAt: now,
        createdBy: actor.access.userId,
      });
      const source = { kind: "adjustment" as const, id: adjustment.id, number: adjustment.number };
      if (roll) {
        await tx.update(rolls).set({ remainingLengthFt: counted.toString() }).where(eq(rolls.id, roll.id));
        // A count above the books is a negative cut: it adds length back, as the demo's ledger reads it.
        await tx.insert(rollCuts).values({
          rollId: roll.id,
          at: now,
          lengthFt: change.negated().toString(),
          reference: adjustment.number,
          byUserId: actor.access.userId,
          sourceType: "adjustment",
          sourceId: adjustment.id,
          sourceNumber: adjustment.number,
          createdBy: actor.access.userId,
        });
      } else {
        await this.writeMovements(tx, [
          {
            id: uuidv7(),
            at: now.toISOString(),
            productId: product.id,
            locationId: input.locationId,
            quantity: change.toString(),
            kind: "adjustment",
            source,
            byUserId: actor.access.userId,
          },
        ]);
      }
      // The change at cost: a roll by its own cost per sq ft, boxed goods by the average cost (ADR 0042).
      const value = roll ? change.times(roll.widthFt).times(roll.costPerSqFt) : change.times(product.cost);
      await this.books.post(
        tx,
        stockAdjustmentPosting(
          {
            id: adjustment.id,
            number: adjustment.number,
            date: clock.day,
            locationId: adjustment.locationId,
            productName: product.name,
          },
          moneyString(value),
        ),
        actor.access.userId,
      );
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: "Corrected stock count",
          targetType: roll ? "roll" : "product",
          targetId: roll?.id ?? product.id,
          targetLabel: roll ? `Roll ${roll.rollNumber}` : product.name,
          before: { quantity: before.toString() },
          after: { quantity: counted.toString(), reason },
        },
        tx,
      );
      return adjustment;
    });
  }

  private ids(actor: Actor) {
    return { movementId: () => uuidv7(), at: new Date().toISOString(), byUserId: actor.access.userId };
  }

  private async writeMovements(tx: CompanyDb, movements: readonly StockMovement[]): Promise<void> {
    if (movements.length === 0) return;
    await tx.insert(stockMovements).values(
      movements.map((movement) => ({
        id: movement.id,
        at: new Date(movement.at),
        productId: movement.productId,
        locationId: movement.locationId,
        quantity: movement.quantity,
        kind: movement.kind,
        sourceType: movement.source.kind,
        sourceId: movement.source.id,
        sourceNumber: movement.source.number,
        byUserId: movement.byUserId,
        createdBy: movement.byUserId,
      })),
    );
  }
}

function refuse(message: string): BadRequestException {
  return new BadRequestException({ code: "invalid_correction", message });
}
