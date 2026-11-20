import { Injectable } from "@nestjs/common";
import type { CompanyDb } from "@workspace/db";
import {
  branches,
  locations,
  quoteLines,
  quotes,
  reservations,
  rolls,
  stockMovements,
  transfers,
} from "@workspace/db/company";
import {
  becomesShowroom,
  locationHolds,
  locationHoldsProblem,
  locationProblem,
  locationStored,
  type Location,
  type LocationInput,
  type LocationRecords,
} from "@workspace/shared";
import { and, eq, inArray, isNull, or, sum } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import { TenantConnectionService } from "../../core/tenancy/tenant-connection.service";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { notFound, refuse } from "../sales/sales-common";
import { loadLocations } from "./inventory-records";
import { lockStock } from "./stock-lock";

/**
 * Adds and changes warehouses and showrooms (Settings → Warehouses and showrooms; ADR 0059, part 4a;
 * spec settings-and-permissions.md rule 29, inventory.md rule 24), in the session's company only.
 * Every save runs under the stock lock, so the holds check, the default and the name checks see every
 * stock change and every other location save before or after it, never during (D8). One audit entry
 * per saved row, the cleared default too (D13).
 */
@Injectable()
export class LocationsService {
  constructor(
    private readonly tenancy: TenantConnectionService,
    private readonly auditLog: AuditService,
  ) {}

  /** POST /locations: a new location with a server-made UUID v7 id. */
  create(tenant: TenantContext, actor: Actor, input: LocationInput): Promise<Location> {
    return this.save(tenant, actor, undefined, input);
  }

  /** PUT /locations/:id: a live location of the session's company, or 404. */
  update(tenant: TenantContext, actor: Actor, id: string, input: LocationInput): Promise<Location> {
    return this.save(tenant, actor, id, input);
  }

  /**
   * The save both routes share: the shared rule against the live rows, then, for a warehouse that
   * becomes a showroom, its holds (D6); then the write, a new default clearing the old (D7), and the
   * audit entries. A refusal throws before anything is written and rolls the transaction back.
   */
  private async save(
    tenant: TenantContext,
    actor: Actor,
    id: string | undefined,
    input: LocationInput,
  ): Promise<Location> {
    const db = await this.tenancy.db(tenant);
    return db.transaction(async (tx) => {
      await lockStock(tx);
      const live = await loadLocations(tx);
      const before = id === undefined ? undefined : live.find((location) => location.id === id);
      // Unknown, deleted, or another company's id: this database never held it as a live location.
      if (id !== undefined && !before) throw notFound("location");
      const others = live.filter((location) => location.id !== id);
      const liveBranches = await tx.select({ id: branches.id }).from(branches).where(isNull(branches.deletedAt));
      const problem =
        locationProblem(input, { before, others, branches: liveBranches }) ??
        (before && becomesShowroom(before, input)
          ? locationHoldsProblem(input.name.trim(), locationHolds(before.id, await loadLocationRecords(tx, before.id)))
          : null);
      if (problem) throw refuse(problem);
      const stored = locationStored(input);
      const savedId = id ?? uuidv7();
      const cleared = stored.isDefault ? others.filter((location) => location.isDefault) : [];
      const now = new Date();
      if (cleared.length > 0)
        await tx
          .update(locations)
          .set({ isDefault: false, updatedAt: now })
          .where(
            inArray(
              locations.id,
              cleared.map((location) => location.id),
            ),
          );
      const columns = {
        name: stored.name,
        kind: stored.kind,
        address: stored.address,
        isDefault: stored.isDefault,
        displaySamples: stored.displaySamples,
        floorAreaSqFt: stored.floorAreaSqFt ?? null,
      };
      // The branch is never updated: it is fixed once added (D5), whatever the rule above let through.
      if (before)
        await tx
          .update(locations)
          .set({ ...columns, updatedAt: now })
          .where(eq(locations.id, savedId));
      else
        await tx
          .insert(locations)
          .values({ id: savedId, ...columns, branchId: stored.branchId, createdBy: actor.access.userId });
      const saved = (await loadLocations(tx)).find((location) => location.id === savedId)!;
      await this.auditLog.record(
        tenant,
        actor.audit,
        {
          category: "settings",
          action: before ? "Changed location" : "Added location",
          targetType: "location",
          targetId: savedId,
          targetLabel: saved.name,
          before: before ?? null,
          after: saved,
        },
        tx,
      );
      for (const old of cleared)
        await this.auditLog.record(
          tenant,
          actor.audit,
          {
            category: "settings",
            action: "Changed location",
            targetType: "location",
            targetId: old.id,
            targetLabel: old.name,
            before: old,
            after: { ...old, isDefault: false },
          },
          tx,
        );
      return saved;
    });
  }
}

/**
 * What points at one location, read narrowly by its id for the holds rule (D6): live rolls, boxed
 * stock summed per product (the ledger is append-only), live transfers from or to it, live
 * reservations at it, and live quotes from it by header or by a live line. The rule itself (statuses,
 * sums, above zero, open quotes) is the shared `locationHolds`, so both modes judge alike.
 */
async function loadLocationRecords(tx: CompanyDb, id: string): Promise<LocationRecords> {
  const [rollRows, stockRows, transferRows, heldRows, headerQuotes, lineQuotes] = await Promise.all([
    tx
      .select({ locationId: rolls.locationId, remainingLengthFt: rolls.remainingLengthFt })
      .from(rolls)
      .where(and(eq(rolls.locationId, id), isNull(rolls.deletedAt))),
    tx
      .select({ productId: stockMovements.productId, quantity: sum(stockMovements.quantity) })
      .from(stockMovements)
      .where(eq(stockMovements.locationId, id))
      .groupBy(stockMovements.productId),
    tx
      .select({ fromId: transfers.fromId, toId: transfers.toId, status: transfers.status })
      .from(transfers)
      .where(and(or(eq(transfers.fromId, id), eq(transfers.toId, id)), isNull(transfers.deletedAt))),
    tx
      .select({ locationId: reservations.locationId, status: reservations.status, quantity: reservations.quantity })
      .from(reservations)
      .where(and(eq(reservations.locationId, id), isNull(reservations.deletedAt))),
    tx
      .select({ status: quotes.status, locationId: quotes.locationId })
      .from(quotes)
      .where(and(eq(quotes.locationId, id), isNull(quotes.deletedAt))),
    tx
      .select({ status: quotes.status, locationId: quotes.locationId })
      .from(quotes)
      .innerJoin(quoteLines, eq(quoteLines.quoteId, quotes.id))
      .where(and(eq(quoteLines.locationId, id), isNull(quoteLines.deletedAt), isNull(quotes.deletedAt))),
  ]);
  return {
    rolls: rollRows,
    movements: stockRows.map((row) => ({ productId: row.productId, locationId: id, quantity: row.quantity ?? "0" })),
    transfers: transferRows,
    reservations: heldRows,
    quotes: [
      ...headerQuotes.map((quote) => ({ ...quote, lines: [] })),
      ...lineQuotes.map((quote) => ({ ...quote, lines: [{ locationId: id }] })),
    ],
  };
}
