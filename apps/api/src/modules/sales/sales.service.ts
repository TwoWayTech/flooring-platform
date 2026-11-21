import { ConflictException, ForbiddenException, Inject, Injectable, Logger } from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import { addresses, customers, measurementRooms, quoteLines, quotes } from "@workspace/db/company";
import {
  computeTotals,
  dec,
  keepsAcceptedTotal,
  productTaxCategory,
  defaultWastePct,
  nextNumber,
  partCartonProblem,
  QUOTE_ACTION_STATUS,
  quoteActions,
  quoteDraftProblem,
  quoteIsOpen,
  quoteSendProblems,
  repricesAcceptedQuote,
  REPRICED_QUOTE_ACTION,
  sameOptionalDecimal,
  savedQuoteLine,
  savedQuoteStatus,
  taxContextFor,
  type Customer,
  type CustomerAddress,
  type DocLine,
  type Product,
  type Quote,
  type QuoteAction,
  type Room,
  type TaxOverride,
} from "@workspace/shared";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { RequestAccess } from "../../core/access/access.service";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { CONTROL_DB } from "../../core/database/control-db";
import { NotificationService } from "../../core/notifications/notification.service";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { loadLocations, loadProducts, loadRolls } from "../inventory/inventory-records";
import { companyToday, notFound, refuse, seesCustomer, seesDocument } from "./sales-common";
import { loadMoneyFormat } from "./invoice-records";
import { customerAudit, loadBranches, loadCustomers, loadLocalization, loadQuotes } from "./sales-records";

/** What adding a customer carries (ApiClient `NewCustomerInput`). */
export interface NewCustomer {
  name: string;
  phone?: string;
  email?: string;
  type?: Customer["type"];
}

/** What a customer edit may change; credit, tax exemption and the rep are not edited here. */
export type CustomerEdit = Pick<
  Customer,
  "type" | "name" | "contactName" | "email" | "phone" | "terms" | "defaultBillingId" | "defaultJobSiteId"
> & { addresses: CustomerAddress[] };

/** What a quote save carries; status, sending and conversion change only through their own calls. */
export type QuoteInput = Pick<
  Quote,
  "customerId" | "locationId" | "jobSite" | "rooms" | "lines" | "depositPct" | "notes"
> & {
  id?: string;
  soldAtLocationId?: string;
  /** A rate changed on the quote, with why; who and when are the server's to record. */
  taxOverride: RequestedOverride | null;
};

/** What the screen sends to change tax on one document. */
export interface RequestedOverride {
  ratePct: string;
  reason: string;
}

/** The first quote number, as in the demo (`Q-2001`). */
const FIRST_QUOTE = 2001;

/** A rate changed on one document: up to two digits and four decimals, with a reason (spec rule 17). */
const OVERRIDE_RATE = /^\d{1,2}(\.\d{1,4})?$/;

/** What a quote's audit entry keeps: everything that decides its price and tax (CLAUDE.md rule 10). */
function quoteAudit(
  quote: Pick<Quote, "customerId" | "locationId" | "jobSite" | "depositPct" | "lines" | "taxOverride"> & {
    soldAtLocationId?: string;
  },
  total: string,
) {
  return {
    customerId: quote.customerId,
    locationId: quote.locationId,
    soldAtLocationId: quote.soldAtLocationId ?? null,
    jobSite: { state: quote.jobSite.state, county: quote.jobSite.county ?? null, zip: quote.jobSite.zip },
    depositPct: quote.depositPct,
    taxOverride: quote.taxOverride ? { ratePct: quote.taxOverride.ratePct, reason: quote.taxOverride.reason } : null,
    lines: quote.lines.map(({ productId, quantity, unitPrice, wastePct }) => ({
      productId,
      quantity,
      unitPrice,
      wastePct,
    })),
    total,
  };
}

/**
 * Sales on the server, part 1 (docs/product-spec/sales.md; ADR 0037): customers and quotes, read
 * through the person's data scope, with quote totals computed here by the shared tax engine from
 * the company's own rules, never taken from the screen. Every write is audited in its transaction.
 * Invoices, payments, credits and refunds come in part 2.
 */
/**
 * Rooms sent back as answered are no change: sizes are compared by value, so "12.500" (as the API
 * answers it) and "12.5" (as typed) are the same room (STATUS B6; whole-product check F-k).
 */
function sameRooms(sent: readonly Room[], saved: readonly Room[]): boolean {
  return (
    sent.length === saved.length &&
    sent.every((room, index) => {
      const was = saved[index]!;
      return (
        room.id === was.id &&
        room.name === was.name &&
        room.x === was.x &&
        room.y === was.y &&
        dec(room.widthFt).eq(was.widthFt) &&
        dec(room.lengthFt).eq(was.lengthFt)
      );
    })
  );
}

@Injectable()
export class SalesService {
  private readonly logger = new Logger("Sales");

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
    private readonly notifications: NotificationService,
  ) {}

  /** Customers the person may see: own through the rep, branch through the rep's branch, or all. */
  async customers(tenant: TenantContext, access: RequestAccess): Promise<Customer[]> {
    const db = await this.tenancy.db(tenant);
    const [list, branches] = await Promise.all([loadCustomers(db), loadBranches(db)]);
    return list.filter((customer) => seesCustomer(access, customer, branches));
  }

  /** Quotes the person may see: own through the rep, branch through the quote's branch, or all. */
  async quotes(tenant: TenantContext, access: RequestAccess): Promise<Quote[]> {
    const list = await loadQuotes(await this.tenancy.db(tenant));
    return list.filter((quote) => seesDocument(access, quote));
  }

  /** Adds a customer (spec "Add a customer"): only a name, the person as rep, the company's terms. */
  async createCustomer(tenant: TenantContext, actor: Actor, input: NewCustomer): Promise<Customer> {
    const name = input.name.trim();
    if (!name) throw refuse("Enter the customer's name.");
    const db = await this.tenancy.db(tenant);
    const localization = await loadLocalization(db, "adding customers");
    const id = uuidv7();
    await db.transaction(async (tx) => {
      await tx.insert(customers).values({
        id,
        type: input.type ?? "homeowner",
        name,
        contactName: name,
        email: input.email?.trim() ?? "",
        phone: input.phone?.trim() ?? "",
        terms: localization.documents.defaultTerms,
        salesRepId: actor.access.userId,
        createdBy: actor.access.userId,
      });
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: "Added customer",
          targetType: "customer",
          targetId: id,
          targetLabel: name,
          after: { type: input.type ?? "homeowner" },
        },
        tx,
      );
    });
    return (await loadCustomers(db, [id]))[0]!;
  }

  /**
   * Changes a customer and their addresses (spec "Edit a customer or their addresses"). Credit,
   * tax exemption, certificate and rep have no edit screen and are never taken from the request.
   * Defaults fall back to the first address when they point at none of the customer's.
   */
  async saveCustomer(tenant: TenantContext, actor: Actor, id: string, input: CustomerEdit): Promise<Customer> {
    const name = input.name.trim();
    if (!name) throw refuse("Enter the customer's name.");
    const db = await this.tenancy.db(tenant);
    await db.transaction(async (tx) => {
      const [before] = await loadCustomers(tx, [id]);
      if (!before || !seesCustomer(actor.access, before, await loadBranches(tx))) throw notFound("customer");
      const known = new Set(before.addresses.map((address) => address.id));
      const kept: CustomerAddress[] = [];
      for (const address of input.addresses) {
        const values = {
          label: address.label,
          street: address.street.trim(),
          city: address.city.trim(),
          state: address.state.trim().toUpperCase(),
          zip: address.zip.trim(),
          county: address.county?.trim() || null,
          lat: address.lat ?? null,
          lng: address.lng ?? null,
        };
        if (known.has(address.id)) {
          await tx.update(addresses).set(values).where(eq(addresses.id, address.id));
          kept.push(address);
        } else {
          const newId = uuidv7();
          await tx.insert(addresses).values({ ...values, id: newId, customerId: id, createdBy: actor.access.userId });
          kept.push({ ...address, id: newId });
        }
      }
      const keptIds = kept.map((address) => address.id);
      await tx
        .update(addresses)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(addresses.customerId, id),
            isNull(addresses.deletedAt),
            keptIds.length > 0 ? notInArray(addresses.id, keptIds) : undefined,
          ),
        );
      // A default given by the screen's id of a new address maps to the id it was stored under.
      const stored = (wanted: string | null) => {
        const index = input.addresses.findIndex((address) => address.id === wanted);
        return index >= 0 ? kept[index]!.id : (keptIds[0] ?? null);
      };
      await tx
        .update(customers)
        .set({
          type: input.type,
          name,
          contactName: input.contactName.trim(),
          email: input.email.trim(),
          phone: input.phone.trim(),
          terms: input.terms,
          defaultBillingId: stored(input.defaultBillingId),
          defaultJobSiteId: stored(input.defaultJobSiteId),
        })
        .where(eq(customers.id, id));
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: "Changed customer",
          targetType: "customer",
          targetId: id,
          targetLabel: name,
          before: customerAudit(before),
          after: customerAudit({ ...input, name, addresses: kept }),
        },
        tx,
      );
    });
    return (await loadCustomers(db, [id]))[0]!;
  }

  /**
   * Saves a quote (spec "Quotes" rules 1 to 18). Status fields are never taken from the request.
   * The total is computed here with the shared tax engine on the company's own rules. Line costs
   * come from the catalog. A changed waste needs `sales.waste.view`; a changed tax needs
   * `sales.tax.override` and is audited on its own.
   */
  async saveQuote(tenant: TenantContext, actor: Actor, input: QuoteInput): Promise<Quote> {
    const problem = quoteDraftProblem(input);
    if (problem) throw refuse(problem);
    const db = await this.tenancy.db(tenant);
    const id = await db.transaction(async (tx) => {
      const before = input.id ? (await loadQuotes(tx, [input.id]))[0] : undefined;
      if (input.id && (!before || !seesDocument(actor.access, before))) throw notFound("quote");
      if (before && !quoteIsOpen(before)) {
        throw new ConflictException({
          code: "quote_closed",
          message: `Quote ${before.number} is closed and can't be changed.`,
        });
      }
      const [customer] = await loadCustomers(tx, [input.customerId]);
      if (!customer || !seesCustomer(actor.access, customer, await loadBranches(tx)))
        throw refuse("Choose a customer.");
      const location = (await loadLocations(tx)).find((candidate) => candidate.id === input.locationId);
      if (location?.kind !== "warehouse") throw refuse("Fulfil the quote from a warehouse.");
      const localization = await loadLocalization(tx);
      const catalog = new Map((await loadProducts(tx)).map((product) => [product.id, product]));
      const lines = this.trustedLines(actor.access, input.lines, before, catalog);
      // Boxed lines are whole cartons (ADR 0027): refused, never rounded, so the quantity is the one sent (F-m).
      const cartons = partCartonProblem(lines, "sell");
      if (cartons) throw refuse(cartons);
      await this.assertReferences(tx, lines, input.soldAtLocationId);
      this.assertRooms(actor.access, input.rooms, before);
      this.assertWaste(actor.access, lines, before, catalog, localization.documents.defaultWastePct);
      const asked = input.taxOverride
        ? { ratePct: input.taxOverride.ratePct, reason: input.taxOverride.reason.trim() }
        : null;
      const had = before?.taxOverride
        ? { ratePct: before.taxOverride.ratePct, reason: before.taxOverride.reason }
        : null;
      const taxChanged = JSON.stringify(had) !== JSON.stringify(asked);
      if (taxChanged) this.assertOverride(actor.access, input.taxOverride);
      // A rate approved for one place does not follow the quote to another without the tax key.
      const moved =
        before !== undefined &&
        (before.jobSite.state !== input.jobSite.state ||
          (before.jobSite.county ?? "") !== (input.jobSite.county ?? ""));
      if (!taxChanged && moved && before?.taxOverride) this.assertOverride(actor.access, input.taxOverride);
      // Who changed the tax and when are the server's to record.
      const taxOverride: TaxOverride | null = !taxChanged
        ? (before?.taxOverride ?? null)
        : asked && { ...asked, byName: actor.session.user.name, at: new Date().toISOString() };
      const day = await companyToday(this.control.db, tenant);
      const ctx = taxContextFor(localization, input.jobSite, customer, day, before?.lumpSum ?? false, taxOverride);
      // An accepted quote keeps the total the customer accepted unless the save reprices it; a
      // repriced one goes back to Pending for the customer to accept the new total (rule 18; ADR 0061, 7).
      const next = {
        customerId: customer.id,
        jobSite: input.jobSite,
        taxOverride,
        lumpSum: before?.lumpSum ?? false,
        depositPct: input.depositPct,
        lines,
      };
      const total = before && keepsAcceptedTotal(before, next) ? before.total : computeTotals(lines, ctx).total;
      const repriced = repricesAcceptedQuote(before, next);

      const quoteId = before?.id ?? uuidv7();
      const values = {
        customerId: customer.id,
        locationId: location.id,
        // The quote's branch is its warehouse's, so data scope follows where it is fulfilled from.
        branchId: location.branchId,
        soldAtLocationId: input.soldAtLocationId ?? null,
        jobSite: input.jobSite,
        depositPct: input.depositPct,
        taxOverride,
        total,
        notes: input.notes,
      };
      let number = before?.number ?? "";
      if (before) {
        // Only from the status read above, so an accept, decline or conversion that commits
        // meanwhile is never overwritten by this save, nor accepted at a total nobody agreed to.
        const [saved] = await tx
          .update(quotes)
          .set({ ...values, status: savedQuoteStatus(before, next) })
          .where(and(eq(quotes.id, quoteId), eq(quotes.status, before.status)))
          .returning({ id: quotes.id });
        if (!saved)
          throw new ConflictException({ code: "quote_state", message: `Quote ${before.number} changed meanwhile.` });
      } else {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('sales:quote-number'))`);
        const existing = await tx.select({ number: quotes.number }).from(quotes);
        number = nextNumber(
          localization.documents.quotePrefix,
          existing.map((row) => row.number),
          FIRST_QUOTE,
        );
        await tx.insert(quotes).values({
          ...values,
          id: quoteId,
          number,
          salesRepId: actor.access.userId,
          status: "draft",
          createdBy: actor.access.userId,
        });
      }
      await this.replaceRoomsAndLines(tx, quoteId, input.rooms, lines, actor.access.userId);
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: before ? "Saved quote" : "Created quote",
          targetType: "quote",
          targetId: quoteId,
          targetLabel: number,
          before: before ? quoteAudit(before, before.total) : null,
          after: { ...quoteAudit({ ...input, lines, taxOverride }, total), taxSource: ctx.source },
        },
        tx,
      );
      if (before && repriced) {
        await this.auditLog.record(
          tenant,
          actor.audit,
          {
            category: "data",
            action: REPRICED_QUOTE_ACTION,
            targetType: "quote",
            targetId: quoteId,
            targetLabel: number,
            before: { status: before.status, total: before.total },
            after: { status: "pending", total },
          },
          tx,
        );
      }
      if (taxChanged) {
        await this.auditLog.record(
          tenant,
          actor.audit,
          {
            category: "data",
            action: "Changed tax on a document",
            targetType: "quote",
            targetId: quoteId,
            targetLabel: number,
            before: before?.taxOverride ?? null,
            after: taxOverride,
          },
          tx,
        );
      }
      return quoteId;
    });
    return (await loadQuotes(db, [id]))[0]!;
  }

  /** Sends, accepts or declines a quote, as its state allows (spec "Quote status"). */
  async updateQuoteStatus(
    tenant: TenantContext,
    actor: Actor,
    quoteId: string,
    action: QuoteAction,
    expiresAt: string | null | undefined,
  ): Promise<Quote> {
    const db = await this.tenancy.db(tenant);
    const day = await companyToday(this.control.db, tenant);
    const updated = await db.transaction(async (tx) => {
      const [quote] = await loadQuotes(tx, [quoteId]);
      if (!quote || !seesDocument(actor.access, quote)) throw notFound("quote");
      if (!quoteActions(quote, day).includes(action)) {
        throw new ConflictException({
          code: "quote_state",
          message: `Quote ${quote.number} can't be changed that way in its current state.`,
        });
      }
      const expiry = action === "send" ? (expiresAt ?? null) : quote.expiresAt;
      if (action === "send") {
        const problem = Object.values(quoteSendProblems(quote, expiry, day))[0];
        if (problem) throw refuse(problem);
      }
      const status = QUOTE_ACTION_STATUS[action];
      const total = action === "send" ? await this.priceOn(tx, quote, day) : quote.total;
      const [moved] = await tx
        .update(quotes)
        .set({
          status,
          total,
          expiresAt: expiry,
          sentAt: quote.sentAt ? undefined : action === "send" ? new Date() : undefined,
        })
        .where(and(eq(quotes.id, quoteId), eq(quotes.status, quote.status)))
        .returning({ id: quotes.id });
      if (!moved)
        throw new ConflictException({ code: "quote_state", message: `Quote ${quote.number} changed meanwhile.` });
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "data",
          action: `Marked quote ${status}`,
          targetType: "quote",
          targetId: quoteId,
          targetLabel: quote.number,
          before: { status: quote.status },
          after: { status, expiresAt: expiry },
        },
        tx,
      );
      return quote;
    });
    // The email is written from the quote as saved, with the total and expiry of this send; the
    // row read inside the transaction still holds the ones before it (ADR 0059, bell and Outbox part, D6).
    const saved = (await loadQuotes(db, [updated.id]))[0]!;
    if (action === "send") await this.emailQuote(tenant, actor, saved);
    return saved;
  }

  /** A quote's total on a day, from the company's rules and the customer's certificate then. */
  private async priceOn(tx: CompanyDb, quote: Quote, day: string): Promise<string> {
    const [customer] = await loadCustomers(tx, [quote.customerId]);
    if (!customer) throw refuse("This quote's customer no longer exists.");
    const ctx = taxContextFor(
      await loadLocalization(tx),
      quote.jobSite,
      customer,
      day,
      quote.lumpSum,
      quote.taxOverride,
    );
    return computeTotals(quote.lines, ctx).total;
  }

  /**
   * Lines as stored: a line's cost comes from its product, or from the same saved line, never from
   * the request, so a person who cannot see cost can neither read nor set it (CLAUDE.md rule 5).
   * The same saved line is the one with the same id and product (`savedQuoteLine`), as for waste.
   */
  private trustedLines(
    access: RequestAccess,
    lines: readonly DocLine[],
    before: Quote | undefined,
    catalog: ReadonlyMap<string, Product>,
  ): DocLine[] {
    const mayChangeTax = access.permissions.has("sales.tax.override");
    return lines.map((line) => {
      const product = line.productId ? catalog.get(line.productId) : undefined;
      if (line.productId && !product) throw refuse("A product on the quote no longer exists.");
      const saved = savedQuoteLine(before?.lines, line);
      if (product) {
        // The tax category and unit are the product's, so a line cannot be made untaxed by
        // calling a material labor (blueprint "Sales tax engine"; PR #14 security review).
        return {
          ...line,
          category: productTaxCategory(product),
          unit: product.unit,
          unitCost: product.cost,
          // The pack is the product's, never the request's, so a line can't claim smaller cartons (F-m).
          sqFtPerCarton: product.sqFtPerCarton,
        };
      }
      // A line with no product keeps the category it was saved with; a new one, a changed
      // category, or a line sent without the product it had decides tax, so it needs the tax key.
      if (!mayChangeTax && saved?.category !== line.category) {
        throw new ForbiddenException({
          code: "forbidden",
          message: "Only someone who may change tax can add a line without a product.",
        });
      }
      // A carton is a product's packaging; a line without a product has none, whatever was sent.
      return { ...line, sqFtPerCarton: undefined, unitCost: saved?.unitCost ?? "0" };
    });
  }

  /**
   * A quote's references must be the company's live records: each roll belongs to its line's
   * product and is not travelling, each line warehouse is a live warehouse, and the sold-at
   * location, which decides whose revenue the sale is (spec rule 11), is a live location.
   */
  private async assertReferences(tx: CompanyDb, lines: readonly DocLine[], soldAt: string | undefined): Promise<void> {
    const locations = await loadLocations(tx);
    if (soldAt && !locations.some((location) => location.id === soldAt)) throw refuse("Choose where the sale is made.");
    const rollIds = lines.flatMap((line) => (line.rollId ? [line.rollId] : []));
    const rolls = rollIds.length > 0 ? await loadRolls(tx, rollIds) : [];
    for (const line of lines) {
      if (line.locationId && locations.find((location) => location.id === line.locationId)?.kind !== "warehouse") {
        throw refuse("A line's warehouse no longer exists.");
      }
      if (!line.rollId) continue;
      const roll = rolls.find((candidate) => candidate.id === line.rollId);
      if (!roll || roll.productId !== line.productId || roll.transferId)
        throw refuse("Choose a roll of this product in stock.");
    }
  }

  /** Drawing rooms is Retail's (spec "Draw rooms on the canvas"); others keep the rooms as saved. */
  private assertRooms(access: RequestAccess, rooms: readonly Room[], before: Quote | undefined): void {
    if (sameRooms(rooms, before?.rooms ?? [])) return;
    if (!access.modules.includes("retail") || !access.permissions.has("retail.room.measure")) {
      throw new ForbiddenException({ code: "forbidden", message: "Your role does not allow measuring rooms." });
    }
  }

  /**
   * Spec rule 8: waste is internal; changing it from what the line had, or from the default, needs
   * `sales.waste.view`. A saved line is the same line only with the same id and product; any other
   * line starts from its product's default. Compared by value (STATUS B6): the API answers
   * "10.00000000" and people type "10", which are the same waste; a blank and a number are not, and
   * text that isn't plain decimal counts as a change.
   */
  private assertWaste(
    access: RequestAccess,
    lines: readonly DocLine[],
    before: Quote | undefined,
    catalog: ReadonlyMap<string, Product>,
    defaults: Parameters<typeof defaultWastePct>[1],
  ): void {
    if (access.permissions.has("sales.waste.view")) return;
    const changed = lines.some((line) => {
      // The same line only with the same id and product: the rep is answered every line's id and
      // waste, so a line moved to another product is new and starts from that product's default.
      const saved = savedQuoteLine(before?.lines, line);
      if (saved) return !sameOptionalDecimal(saved.wastePct, line.wastePct);
      const product = line.productId ? catalog.get(line.productId) : undefined;
      const expected = product ? defaultWastePct(product, defaults) : undefined;
      return !sameOptionalDecimal(expected, line.wastePct);
    });
    if (changed)
      throw new ForbiddenException({ code: "forbidden", message: "Your role does not allow changing waste." });
  }

  /** Spec rule 17: a changed tax needs `sales.tax.override`, a rate of up to 2 digits and 4 decimals, and a reason. */
  private assertOverride(access: RequestAccess, override: RequestedOverride | null | undefined): void {
    if (!access.permissions.has("sales.tax.override")) {
      throw new ForbiddenException({
        code: "forbidden",
        message: "Your role does not allow changing tax on a document.",
      });
    }
    if (override && (!OVERRIDE_RATE.test(override.ratePct) || override.reason.trim().length < 3)) {
      throw refuse("Enter a rate such as 7.25 and say why it changes.");
    }
  }

  /**
   * Rooms and lines are replaced as a whole on each save; line room ids follow the rooms' new ids.
   * Nothing may point at a quote line's id: an invoice copies its lines, and reservations point at
   * invoice lines (ADR 0037). Rooms keep their order through staggered creation times.
   */
  private async replaceRoomsAndLines(
    tx: CompanyDb,
    quoteId: string,
    rooms: readonly Room[],
    lines: readonly DocLine[],
    by: string,
  ): Promise<void> {
    const now = new Date();
    await tx
      .update(measurementRooms)
      .set({ deletedAt: now })
      .where(and(eq(measurementRooms.quoteId, quoteId), isNull(measurementRooms.deletedAt)));
    await tx
      .update(quoteLines)
      .set({ deletedAt: now })
      .where(and(eq(quoteLines.quoteId, quoteId), isNull(quoteLines.deletedAt)));
    const roomIds = new Map(rooms.map((room) => [room.id, uuidv7()]));
    if (rooms.length > 0) {
      await tx.insert(measurementRooms).values(
        rooms.map((room, index) => ({
          id: roomIds.get(room.id)!,
          createdAt: new Date(now.getTime() + index),
          quoteId,
          name: room.name,
          x: room.x,
          y: room.y,
          widthFt: room.widthFt,
          lengthFt: room.lengthFt,
          createdBy: by,
        })),
      );
    }
    if (lines.length > 0) {
      await tx.insert(quoteLines).values(
        lines.map((line, position) => ({
          quoteId,
          position,
          productId: line.productId ?? null,
          description: line.description,
          category: line.category,
          unit: line.unit,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          unitCost: line.unitCost,
          wastePct: line.wastePct ?? null,
          rollId: line.rollId ?? null,
          sqFtPerCarton: line.sqFtPerCarton ?? null,
          locationId: line.locationId ?? null,
          roomIds: (line.roomIds ?? []).flatMap((roomId) => (roomIds.has(roomId) ? [roomIds.get(roomId)!] : [])),
          createdBy: by,
        })),
      );
    }
  }

  /** Emails the quote to the customer (event `quote.sent`); a failure is logged and never undoes the send. */
  private async emailQuote(tenant: TenantContext, actor: Actor, quote: Quote): Promise<void> {
    try {
      const db = await this.tenancy.db(tenant);
      const [[customer], money] = await Promise.all([loadCustomers(db, [quote.customerId]), loadMoneyFormat(db)]);
      if (!customer?.email) return;
      await this.notifications.notify(tenant, actor.access.userId, {
        event: "quote.sent",
        source: { type: "quote", id: quote.id },
        to: [{ kind: "customer", id: customer.id, name: customer.name, email: customer.email }],
        // The total in the company's number format, as every other message's money (spec rule 11).
        values: {
          "customer.name": customer.name,
          "quote.number": quote.number,
          "quote.total": money(quote.total),
          "quote.expires": quote.expiresAt ?? "",
        },
      });
    } catch {
      this.logger.warn("A quote was sent, but its email could not be queued.");
    }
  }
}
