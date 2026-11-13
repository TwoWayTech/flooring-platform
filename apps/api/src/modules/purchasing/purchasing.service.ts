import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import {
  goodsReceipts,
  poLines,
  purchaseOrders,
  receiptLines,
  rolls,
  settings,
  stockMovements,
  supplierContacts,
  suppliers,
} from "@workspace/db/company";
import { user } from "@workspace/db/control";
import {
  contactProblem,
  dec,
  nextNumber,
  nextPaymentNumber,
  poTotal,
  receiptProblem,
  receiptStock,
  type GoodsReceipt,
  type LocalizationSettings,
  type PoLine,
  type PurchaseOrder,
  type ReceiptLine,
  type Supplier,
  type SupplierContact,
} from "@workspace/shared";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { NotificationService } from "../../core/notifications/notification.service";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { loadLocations, loadProducts } from "../inventory/inventory-records";
import { lockStock } from "../inventory/stock-lock";
import { loadContacts, loadOrders, loadReceipts, loadSuppliers } from "./purchasing-records";

/** What a supplier save carries (ApiClient `SupplierInput`); missing fields keep their value. */
export type SupplierInput = Partial<Omit<Supplier, "id" | "status" | "categories" | "externalId">> & {
  name: string;
  from?: "order";
};

/** What a contact save carries (ApiClient `SupplierContactInput`). */
export type ContactInput = Omit<SupplierContact, "id" | "status">;

/** What a new purchase order carries (ApiClient `NewPurchaseOrderInput`). */
export interface OrderInput {
  supplierId: string;
  contactId: string | null;
  supplierRef: string;
  placedVia: "email" | "phone" | null;
  expectedAt: string;
  locationId: string;
  lines: Omit<PoLine, "id">[];
  asDraft: boolean;
}

/** What a goods receipt carries (ApiClient `ReceiptInput`). */
export interface ReceiptInput {
  locationId: string;
  lines: ReceiptLine[];
  note: string;
}

const NO_ADDRESS = { street: "", city: "", state: "", zip: "" };

/** The first order number, as in the demo (`PO-3001`). */
const FIRST_ORDER = 3001;

function refuse(message: string): BadRequestException {
  return new BadRequestException({ code: "invalid_request", message });
}

/**
 * Purchasing on the server, part 1 (docs/product-spec/purchasing.md; ADR 0036): the supplier
 * directory with contacts, purchase orders and goods receipts. A receipt brings stock in under the
 * same per-company lock as every other stock change. Every write is audited in its transaction.
 * Bills and supplier payments post to the ledger, so they move with P12.
 */
@Injectable()
export class PurchasingService {
  private readonly logger = new Logger("Purchasing");

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  async suppliers(tenant: TenantContext): Promise<Supplier[]> {
    return loadSuppliers(await this.tenancy.db(tenant));
  }

  async contacts(tenant: TenantContext): Promise<SupplierContact[]> {
    return loadContacts(await this.tenancy.db(tenant));
  }

  async orders(tenant: TenantContext): Promise<PurchaseOrder[]> {
    return loadOrders(await this.tenancy.db(tenant));
  }

  /** Goods receipts with the receiver's name from the control database. */
  async receipts(tenant: TenantContext): Promise<GoodsReceipt[]> {
    const list = await loadReceipts(await this.tenancy.db(tenant));
    const ids = [...new Set(list.map((receipt) => receipt.receivedById))];
    const names =
      ids.length === 0
        ? []
        : await this.control.db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, ids));
    return list.map((receipt) => ({
      ...receipt,
      receivedBy: names.find((name) => name.id === receipt.receivedById)?.name ?? "",
    }));
  }

  /**
   * Adds or edits a supplier (spec B1): only a name is needed, so one can be added in the middle of
   * an order; missing fields keep their value, or the safe default (pay on order, no credit).
   */
  async saveSupplier(tenant: TenantContext, actor: Actor, id: string | null, input: SupplierInput): Promise<Supplier> {
    const name = input.name.trim();
    if (!name) throw refuse("Enter the supplier's name.");
    const db = await this.tenancy.db(tenant);
    const savedId = await db.transaction(async (tx) => {
      const before = id ? (await loadSuppliers(tx, [id]))[0] : undefined;
      if (id && !before) throw new NotFoundException({ code: "not_found", message: "This supplier no longer exists." });
      const values = {
        name,
        type: input.type ?? before?.type ?? "goods",
        accountNumber: input.accountNumber ?? before?.accountNumber ?? "",
        email: input.email ?? before?.email ?? "",
        phone: input.phone ?? before?.phone ?? "",
        terms: input.terms ?? before?.terms ?? "pay_on_order",
        creditLimit: input.creditLimit ?? before?.creditLimit ?? "0.00",
        address: input.address ?? before?.address ?? NO_ADDRESS,
        track1099: input.track1099 ?? before?.track1099 ?? false,
        taxForm: input.taxForm ?? before?.taxForm ?? null,
        notes: input.notes ?? before?.notes ?? "",
      };
      const target = before?.id ?? uuidv7();
      if (before) await tx.update(suppliers).set(values).where(eq(suppliers.id, target));
      else await tx.insert(suppliers).values({ ...values, id: target, createdBy: actor.access.userId });
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: before
            ? "Edited supplier"
            : input.from === "order"
              ? "Added supplier from a purchase order"
              : "Added supplier",
          targetType: "supplier",
          targetId: target,
          targetLabel: name,
          before: before ? auditedSupplier(before) : null,
          after: auditedSupplier(values),
        },
        tx,
      );
      return target;
    });
    return (await loadSuppliers(db, [savedId]))[0]!;
  }

  /** Deactivates or reactivates a supplier (ADR 0022); one with an open order stays active. */
  async setSupplierStatus(
    tenant: TenantContext,
    actor: Actor,
    id: string,
    status: Supplier["status"],
  ): Promise<Supplier> {
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const [supplier] = await loadSuppliers(tx, [id]);
      if (!supplier) throw new NotFoundException({ code: "not_found", message: "This supplier no longer exists." });
      if (status === "inactive") {
        const [open] = await tx
          .select({ id: purchaseOrders.id })
          .from(purchaseOrders)
          .where(
            and(
              eq(purchaseOrders.supplierId, id),
              eq(purchaseOrders.status, "ordered"),
              isNull(purchaseOrders.deletedAt),
            ),
          )
          .limit(1);
        if (open)
          throw new ConflictException({
            code: "supplier_in_use",
            message: `${supplier.name} has an open order, so it stays active.`,
          });
      }
      await tx.update(suppliers).set({ status }).where(eq(suppliers.id, id));
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: "Changed supplier status",
          targetType: "supplier",
          targetId: id,
          targetLabel: supplier.name,
          before: { status: supplier.status },
          after: { status },
        },
        tx,
      );
    });
    return (await loadSuppliers(db, [id]))[0]!;
  }

  /**
   * Adds or edits a contact (spec B1, B2; ADR 0022): a name plus an email or a phone. The first
   * active contact becomes primary, and marking another primary clears the old one.
   */
  async saveContact(
    tenant: TenantContext,
    actor: Actor,
    id: string | null,
    input: ContactInput,
  ): Promise<SupplierContact> {
    const problem = contactProblem(input);
    if (problem) throw refuse(problem);
    const db = await this.tenancy.db(tenant);
    const savedId = await db.transaction(async (tx) => {
      const [supplier] = await loadSuppliers(tx, [input.supplierId]);
      if (!supplier) throw new NotFoundException({ code: "not_found", message: "This supplier no longer exists." });
      const before = id ? (await loadContacts(tx, [id]))[0] : undefined;
      if (id && (!before || before.supplierId !== supplier.id)) {
        throw new NotFoundException({ code: "not_found", message: "This contact no longer exists." });
      }
      const others = (await loadContacts(tx)).filter(
        (contact) => contact.supplierId === supplier.id && contact.status === "active" && contact.id !== before?.id,
      );
      const target = before?.id ?? uuidv7();
      const values = {
        supplierId: supplier.id,
        name: input.name.trim(),
        role: input.role,
        mobile: input.mobile.trim(),
        officePhone: input.officePhone.trim(),
        email: input.email.trim(),
        whatsapp: input.whatsapp,
        preferredMethod: input.preferredMethod,
        notes: input.notes.trim(),
        isPrimary: input.isPrimary || others.length === 0,
      };
      if (before) await tx.update(supplierContacts).set(values).where(eq(supplierContacts.id, target));
      else await tx.insert(supplierContacts).values({ ...values, id: target, createdBy: actor.access.userId });
      if (values.isPrimary) {
        await tx
          .update(supplierContacts)
          .set({ isPrimary: false })
          .where(and(eq(supplierContacts.supplierId, supplier.id), ne(supplierContacts.id, target)));
      }
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: before ? "Edited supplier contact" : "Added supplier contact",
          targetType: "supplier_contact",
          targetId: target,
          targetLabel: `${values.name}, ${supplier.name}`,
          before: before ? { name: before.name } : null,
          after: { name: values.name, isPrimary: values.isPrimary },
        },
        tx,
      );
      return target;
    });
    return (await loadContacts(db, [savedId]))[0]!;
  }

  /**
   * Deactivates or reactivates a contact (ADR 0022). When the primary leaves, the oldest active
   * sales rep takes over, then the oldest active contact.
   */
  async setContactStatus(
    tenant: TenantContext,
    actor: Actor,
    id: string,
    status: SupplierContact["status"],
  ): Promise<SupplierContact> {
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const [contact] = await loadContacts(tx, [id]);
      if (!contact) throw new NotFoundException({ code: "not_found", message: "This contact no longer exists." });
      const leavingPrimary = status === "inactive" && contact.isPrimary;
      let handedTo: string | null = null;
      await tx
        .update(supplierContacts)
        .set({ status, isPrimary: leavingPrimary ? false : contact.isPrimary })
        .where(eq(supplierContacts.id, id));
      if (leavingPrimary) {
        const rows = await tx
          .select({ id: supplierContacts.id, role: supplierContacts.role, createdAt: supplierContacts.createdAt })
          .from(supplierContacts)
          .where(
            and(
              eq(supplierContacts.supplierId, contact.supplierId),
              eq(supplierContacts.status, "active"),
              isNull(supplierContacts.deletedAt),
              ne(supplierContacts.id, id),
            ),
          );
        const byAge = rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const next = byAge.find((row) => row.role === "sales_rep") ?? byAge[0];
        if (next) await tx.update(supplierContacts).set({ isPrimary: true }).where(eq(supplierContacts.id, next.id));
        handedTo = next?.id ?? null;
      }
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: "Changed contact status",
          targetType: "supplier_contact",
          targetId: id,
          targetLabel: contact.name,
          before: { status: contact.status, isPrimary: contact.isPrimary },
          after: { status, ...(leavingPrimary ? { primaryHandedTo: handedTo } : {}) },
        },
        tx,
      );
    });
    return (await loadContacts(db, [id]))[0]!;
  }

  /** Creates a purchase order (spec D1): a draft, or ordered at once, which emails the rep. */
  async createOrder(tenant: TenantContext, actor: Actor, input: OrderInput): Promise<PurchaseOrder> {
    if (input.lines.length === 0) throw refuse("Add at least one line to the purchase order.");
    if (input.lines.some((line) => !dec(line.quantity || "0").gt(0))) throw refuse("Every line needs a quantity.");
    const db = await this.tenancy.db(tenant);
    const id = await db.transaction(async (tx) => {
      const [supplier] = await loadSuppliers(tx, [input.supplierId]);
      if (!supplier || supplier.status !== "active") throw refuse("Choose a supplier.");
      const contact = input.contactId ? (await loadContacts(tx, [input.contactId]))[0] : undefined;
      if (input.contactId && (contact?.supplierId !== supplier.id || contact.status !== "active")) {
        throw refuse("Choose one of this supplier's active contacts.");
      }
      const locations = await loadLocations(tx);
      const lineLocations = input.lines
        .map((line) => line.locationId)
        .filter((value): value is string => Boolean(value));
      for (const locationId of [input.locationId, ...lineLocations]) {
        if (locations.find((location) => location.id === locationId)?.kind !== "warehouse")
          throw refuse("Receive into a warehouse.");
      }
      const catalog = new Map((await loadProducts(tx)).map((product) => [product.id, product]));
      if (input.lines.some((line) => !catalog.has(line.productId)))
        throw refuse("A product on the order no longer exists.");
      // The unit and carton size come from the product, never from the screen (CLAUDE.md rule 7).
      const lines = input.lines.map((line) => {
        const product = catalog.get(line.productId)!;
        return { ...line, unit: product.unit, sqFtPerCarton: product.sqFtPerCarton };
      });
      const total = poTotal(lines);
      // numeric(14,2): a total this large is a typing mistake, refused rather than failing in the database.
      if (dec(total).gte("1e12")) throw refuse("This order's total is too large. Check the quantities and costs.");
      // Order numbers are taken one at a time, so two orders saved together never share one.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('purchasing:po-number'))`);
      const existing = await tx.select({ number: purchaseOrders.number }).from(purchaseOrders);
      const orderId = uuidv7();
      const ordered = !input.asDraft;
      const number = nextNumber(
        await this.poPrefix(tx),
        existing.map((row) => row.number),
        FIRST_ORDER,
      );
      await tx.insert(purchaseOrders).values({
        id: orderId,
        number,
        supplierId: supplier.id,
        status: ordered ? "ordered" : "draft",
        locationId: input.locationId,
        expectedAt: input.expectedAt,
        orderedAt: ordered ? new Date() : null,
        total,
        contactId: contact?.id ?? null,
        contactSnapshot: ordered && contact ? snapshotOf(contact) : null,
        supplierRef: input.supplierRef.trim(),
        buyerId: actor.access.userId,
        placedVia: ordered ? (input.placedVia ?? "email") : null,
        createdBy: actor.access.userId,
      });
      await tx.insert(poLines).values(
        lines.map((line, position) => ({
          poId: orderId,
          position,
          productId: line.productId,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitCost: line.unitCost,
          sqFtPerCarton: line.sqFtPerCarton ?? null,
          locationId: line.locationId ?? null,
          createdBy: actor.access.userId,
        })),
      );
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: ordered ? "Created purchase order" : "Saved purchase order draft",
          targetType: "purchase_order",
          targetId: orderId,
          targetLabel: number,
          after: { status: ordered ? "ordered" : "draft", lines: input.lines.length },
        },
        tx,
      );
      return orderId;
    });
    const [order] = await loadOrders(db, [id]);
    if (order!.status === "ordered" && order!.placedVia !== "phone") await this.emailOrder(tenant, actor, order!);
    return order!;
  }

  /** Sends a draft to the supplier (Draft → Ordered). */
  async markOrdered(tenant: TenantContext, actor: Actor, poId: string, via: "email" | "phone"): Promise<PurchaseOrder> {
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const [po] = await loadOrders(tx, [poId]);
      if (!po) throw new NotFoundException({ code: "not_found", message: "This purchase order no longer exists." });
      const [supplier] = await loadSuppliers(tx, [po.supplierId]);
      if (supplier?.status !== "active") throw refuse("This supplier is inactive. Reactivate it before ordering.");
      const found = po.contactId ? (await loadContacts(tx, [po.contactId]))[0] : undefined;
      // A rep who left since the draft gets nothing; the supplier's own address is used instead.
      const contact = found?.status === "active" ? found : undefined;
      const [moved] = await tx
        .update(purchaseOrders)
        .set({
          status: "ordered",
          orderedAt: new Date(),
          placedVia: via,
          contactSnapshot: contact ? snapshotOf(contact) : null,
        })
        .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.status, "draft")))
        .returning({ id: purchaseOrders.id });
      if (!moved) throw new ConflictException({ code: "not_draft", message: `${po.number} is not a draft.` });
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: "Ordered purchase order",
          targetType: "purchase_order",
          targetId: poId,
          targetLabel: po.number,
          before: { status: "draft" },
          after: { status: "ordered", via },
        },
        tx,
      );
    });
    const [order] = await loadOrders(db, [poId]);
    if (via === "email") await this.emailOrder(tenant, actor, order!);
    return order!;
  }

  /** Cancels an order before anything arrived (spec D1), with a reason. */
  async cancelOrder(tenant: TenantContext, actor: Actor, poId: string, reason: string): Promise<PurchaseOrder> {
    if (reason.trim().length < 3) throw refuse("Say why the order is cancelled.");
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      await lockStock(tx);
      const [po] = await loadOrders(tx, [poId]);
      if (!po) throw new NotFoundException({ code: "not_found", message: "This purchase order no longer exists." });
      if (po.status === "cancelled")
        throw new ConflictException({ code: "already_cancelled", message: `${po.number} is already cancelled.` });
      if ((await loadReceipts(tx, [poId])).length > 0) {
        throw new ConflictException({
          code: "has_receipts",
          message: `${po.number} has receipts and can't be cancelled.`,
        });
      }
      await tx
        .update(purchaseOrders)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(purchaseOrders.id, poId));
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: "Cancelled purchase order",
          targetType: "purchase_order",
          targetId: poId,
          targetLabel: po.number,
          before: { status: po.status },
          after: { status: "cancelled", reason: reason.trim() },
        },
        tx,
      );
    });
    return (await loadOrders(db, [poId]))[0]!;
  }

  /**
   * Records what arrived (spec D2): good and damaged units per line, roll numbers and dye lots, the
   * receiving warehouse. Partial receipts are fine, never more than is still due; the receipt writes
   * its stock movements and rolls under the stock lock.
   */
  async recordReceipt(tenant: TenantContext, actor: Actor, poId: string, input: ReceiptInput): Promise<GoodsReceipt> {
    const db = await this.tenancy.db(tenant);
    const receiptId = await db.transaction(async (tx) => {
      await lockStock(tx);
      const [po] = await loadOrders(tx, [poId]);
      if (!po) throw new NotFoundException({ code: "not_found", message: "This purchase order no longer exists." });
      const lines = input.lines.filter((line) =>
        dec(line.received || "0")
          .plus(line.damaged || "0")
          .gt(0),
      );
      const catalog = await loadProducts(tx);
      const problem = receiptProblem(po, lines, await loadReceipts(tx, [poId]), catalog);
      if (problem) throw refuse(problem);
      const locations = await loadLocations(tx);
      const targets = [
        input.locationId || po.locationId,
        ...lines.flatMap((line) => (line.locationId ? [line.locationId] : [])),
      ];
      if (
        targets.some((locationId) => locations.find((location) => location.id === locationId)?.kind !== "warehouse")
      ) {
        throw refuse("Receive into a warehouse.");
      }
      for (const line of lines) {
        const ordered = po.lines.find((poLine) => poLine.id === line.poLineId);
        if (ordered && ordered.productId !== line.productId) throw refuse("A line's product does not match the order.");
      }
      const numbers = await tx.select({ number: goodsReceipts.number }).from(goodsReceipts);
      const now = new Date();
      const receipt: GoodsReceipt = {
        id: uuidv7(),
        number: nextPaymentNumber(
          "GR-",
          numbers.map((row) => row.number),
        ),
        poId: po.id,
        supplierId: po.supplierId,
        locationId: input.locationId || po.locationId,
        receivedAt: now.toISOString(),
        receivedById: actor.access.userId,
        receivedBy: actor.session.user.name,
        note: input.note.trim(),
        lines: lines.map((line) => ({ ...line, received: line.received || "0", damaged: line.damaged || "0" })),
      };
      const stock = receiptStock(po, receipt, catalog, { movementId: () => uuidv7(), rollId: () => uuidv7() });
      // Every roll number is unique, deleted rolls included, and within this receipt too.
      const taken = new Set((await tx.select({ number: rolls.rollNumber }).from(rolls)).map((row) => row.number));
      const clash = stock.rolls.find((roll) => {
        if (taken.has(roll.rollNumber)) return true;
        taken.add(roll.rollNumber);
        return false;
      });
      if (clash)
        throw refuse(`Roll number ${clash.rollNumber} is already in stock. Enter the roll numbers on the label.`);
      await tx.insert(goodsReceipts).values({
        id: receipt.id,
        number: receipt.number,
        poId: po.id,
        supplierId: po.supplierId,
        locationId: receipt.locationId,
        receivedAt: now,
        receivedById: actor.access.userId,
        note: receipt.note,
        createdBy: actor.access.userId,
      });
      await tx.insert(receiptLines).values(
        receipt.lines.map((line) => ({
          receiptId: receipt.id,
          poLineId: line.poLineId,
          productId: line.productId,
          received: line.received,
          damaged: line.damaged,
          rolls: line.rolls,
          locationId: line.locationId ?? null,
          createdBy: actor.access.userId,
        })),
      );
      if (stock.movements.length > 0) {
        await tx.insert(stockMovements).values(
          stock.movements.map((movement) => ({
            id: movement.id,
            at: now,
            productId: movement.productId,
            locationId: movement.locationId,
            quantity: movement.quantity,
            kind: movement.kind,
            sourceType: movement.source.kind,
            sourceId: movement.source.id,
            sourceNumber: movement.source.number,
            byUserId: actor.access.userId,
            createdBy: actor.access.userId,
          })),
        );
      }
      if (stock.rolls.length > 0) {
        await tx.insert(rolls).values(
          stock.rolls.map((roll) => ({
            id: roll.id,
            rollNumber: roll.rollNumber,
            productId: roll.productId,
            dyeLot: roll.dyeLot,
            widthFt: String(roll.widthFt),
            originalLengthFt: roll.originalLengthFt,
            remainingLengthFt: roll.remainingLengthFt,
            costPerSqFt: roll.costPerSqFt,
            locationId: roll.locationId,
            bin: roll.bin,
            receivedAt: now,
            createdBy: actor.access.userId,
          })),
        );
      }
      const damaged = receipt.lines.reduce((total, line) => total.plus(line.damaged), dec(0));
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: "Received goods",
          targetType: "goods_receipt",
          targetId: receipt.id,
          targetLabel: `${receipt.number} for ${po.number}`,
          after: { rolls: stock.rolls.length, stockLines: stock.movements.length, damaged: damaged.toString() },
        },
        tx,
      );
      return receipt.id;
    });
    const [receipt] = (await this.receipts(tenant)).filter((candidate) => candidate.id === receiptId);
    return receipt!;
  }

  /** The company's purchase order prefix from Settings → Documents, `PO-` when none is set. */
  private async poPrefix(tx: CompanyDb): Promise<string> {
    const [row] = await tx.select({ value: settings.value }).from(settings).where(eq(settings.group, "localization"));
    const value = row?.value as Partial<LocalizationSettings> | undefined;
    return value?.documents?.poPrefix || "PO-";
  }

  /**
   * Emails the order to the rep, or to the supplier's own address when the rep has none (spec A4,
   * B2: event `po.sent`). The order is already saved, so a failure here is logged, not thrown.
   */
  private async emailOrder(tenant: TenantContext, actor: Actor, po: PurchaseOrder): Promise<void> {
    try {
      const db = await this.tenancy.db(tenant);
      const [supplier] = await loadSuppliers(db, [po.supplierId]);
      const contact = po.contactId ? (await loadContacts(db, [po.contactId]))[0] : undefined;
      const recipient = contact?.email
        ? { kind: "supplier_contact" as const, id: contact.id, name: contact.name, email: contact.email }
        : {
            kind: "supplier" as const,
            id: po.supplierId,
            name: supplier?.name ?? "Supplier",
            email: supplier?.email ?? "",
          };
      await this.notifications.notify(tenant, actor.access.userId, {
        event: "po.sent",
        source: { type: "purchaseOrder", id: po.id },
        to: [recipient],
        values: { "contact.name": recipient.name, "po.number": po.number, "po.expected": po.expectedAt },
      });
    } catch {
      this.logger.warn("A purchase order was saved, but its email could not be queued.");
    }
  }
}

/**
 * What a supplier's audit entry keeps: everything that changes who gets orders or money, so a
 * changed email or credit limit can be traced (PR #13 security review). No tax ID is ever stored.
 */
function auditedSupplier(supplier: Omit<Supplier, "id" | "status" | "categories" | "externalId">) {
  return {
    name: supplier.name,
    type: supplier.type,
    terms: supplier.terms,
    creditLimit: supplier.creditLimit,
    email: supplier.email,
    phone: supplier.phone,
    accountNumber: supplier.accountNumber,
    track1099: supplier.track1099,
    w9OnFile: supplier.taxForm?.w9OnFile ?? false,
  };
}

/** The rep as they are now, kept on the order so history survives them leaving (ADR 0022). */
function snapshotOf(contact: SupplierContact) {
  return { name: contact.name, email: contact.email, phone: contact.mobile || contact.officePhone };
}
