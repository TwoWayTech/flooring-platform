import type { CompanySettings } from "@workspace/shared";
import type { CompanyDb } from "../client";
import {
  branches,
  documentSequences,
  goodsReceipts,
  locations,
  poLines,
  products,
  purchaseOrders,
  receiptLines,
  supplierContacts,
  suppliers,
  rollCuts,
  rolls,
  stockMovements,
  transferLines,
  transfers,
  rolePermissions,
  roles,
  settings,
  taxJurisdictions,
  taxRules,
  userProfiles,
  userRoles,
  type SettingsGroup,
} from "../company";
import { and, eq, isNull } from "drizzle-orm";
import { seededUserId } from "./control";
import { seedId, type DemoCompany } from "./fixtures";

/** Settings groups as stored: branding lives in the control database, tax rules and county rates in their own tables. */
function settingsRows(companyId: string, value: CompanySettings) {
  const { branding, localization, ...rest } = value;
  const { rules, jurisdictions, ...tax } = localization.tax;
  const groups: Record<SettingsGroup, unknown> = { ...rest, localization: { ...localization, tax } };
  return Object.entries(groups).map(([group, groupValue]) => ({
    id: seedId(`${companyId}:settings:${group}`),
    group: group as SettingsGroup,
    value: groupValue,
  }));
}

/** The numbering each document kind starts from, with the company's prefixes. */
function sequenceRows(companyId: string, value: CompanySettings) {
  const documents = value.localization.documents;
  const prefixes = {
    quote: documents.quotePrefix,
    invoice: documents.invoicePrefix,
    purchase_order: documents.poPrefix,
    payment: value.payments.paymentPrefix,
    refund: value.payments.refundPrefix,
  };
  return Object.entries(prefixes).map(([kind, prefix]) => ({
    id: seedId(`${companyId}:sequence:${kind}`),
    kind,
    prefix,
  }));
}

async function seedOrganization(tx: CompanyDb, { company, fixtures }: DemoCompany): Promise<void> {
  await tx
    .insert(branches)
    .values(company.branches.map((branch) => ({ ...branch, id: seedId(branch.id) })))
    .onConflictDoNothing();
  await tx
    .insert(locations)
    .values(
      fixtures.locations.map((location) => ({
        ...location,
        id: seedId(location.id),
        branchId: seedId(location.branchId),
        floorAreaSqFt: location.floorAreaSqFt ?? null,
      })),
    )
    .onConflictDoNothing();
  await tx.insert(settings).values(settingsRows(company.id, fixtures.settings)).onConflictDoNothing();
  await tx.insert(documentSequences).values(sequenceRows(company.id, fixtures.settings)).onConflictDoNothing();
  const tax = fixtures.settings.localization.tax;
  if (tax.rules.length > 0) {
    await tx
      .insert(taxRules)
      .values(
        tax.rules.map((rule) => ({
          ...rule,
          id: seedId(`${company.id}:tax:${rule.state}:${rule.version}`),
          validTo: rule.validTo ?? null,
        })),
      )
      .onConflictDoNothing();
  }
  if (tax.jurisdictions.length > 0) {
    await tx
      .insert(taxJurisdictions)
      .values(tax.jurisdictions.map((rate) => ({ ...rate, id: seedId(`${company.id}:${rate.id}`) })))
      .onConflictDoNothing();
  }
}

async function seedAccess(tx: CompanyDb, { fixtures }: DemoCompany): Promise<void> {
  for (const role of fixtures.roles) {
    const roleId = seedId(role.id);
    await tx
      .insert(roles)
      .values({
        id: roleId,
        key: role.key,
        name: role.name,
        description: role.description,
        dataScope: role.dataScope,
        system: role.system,
        owner: role.owner,
      })
      .onConflictDoNothing();
    await tx
      .insert(rolePermissions)
      .values(role.permissions.map((key) => ({ id: seedId(`${role.id}:${key}`), roleId, permissionKey: key })))
      .onConflictDoNothing();
  }
  for (const person of fixtures.users) {
    const userId = seededUserId(person.id);
    // Employees arrive with the HR module, so the employee link stays empty for now.
    await tx
      .insert(userProfiles)
      .values({
        id: seedId(`profile:${person.id}`),
        userId,
        title: person.title,
        branchId: seedId(person.branchId),
        status: person.status,
        defaultLocationId: person.defaultLocationId ? seedId(person.defaultLocationId) : null,
      })
      .onConflictDoNothing();
    await tx
      .insert(userRoles)
      .values(
        person.roleIds.map((roleId) => ({ id: seedId(`${person.id}:${roleId}`), userId, roleId: seedId(roleId) })),
      )
      .onConflictDoNothing();
  }
}

/**
 * A fixture timestamp as an instant. Fixture times such as `2026-04-16T14:15` carry no zone, which
 * JavaScript would read as the machine's local time; they are UTC, so every machine seeds the same.
 */
function utc(value: string): Date {
  return new Date(/T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value) ? `${value}Z` : value);
}

/** A fixture user id as the control database's user id, or null when there is none. */
function userOf(id: string | null | undefined): string | null {
  return id ? seededUserId(id) : null;
}

/**
 * The catalog and stock of the demo company (inventory, part 1; ADR 0035): products, transfers,
 * rolls with their cuts, and the boxed-stock ledger, with the seed's deterministic ids. Suppliers
 * arrive with purchasing (task 4), so products have none yet. Rows that point at an invoice or a
 * receipt store that document's `seedId` and number, so they match it once sales and purchasing
 * seed their documents with the same ids (there is no foreign key).
 */
async function seedCatalog(tx: CompanyDb, { fixtures }: DemoCompany): Promise<void> {
  if (fixtures.products.length === 0) return;
  await tx
    .insert(products)
    .values(
      fixtures.products.map((product) => ({
        id: seedId(product.id),
        sku: product.sku,
        name: product.name,
        brand: product.brand,
        collection: product.collection,
        colorName: product.colorName,
        swatch: product.swatch,
        category: product.category,
        unit: product.unit,
        price: product.price,
        cost: product.cost,
        sqFtPerCarton: product.sqFtPerCarton ?? null,
        reorderPoint: product.reorderPoint === undefined ? null : String(product.reorderPoint),
        widthFt: product.widthFt === undefined ? null : String(product.widthFt),
        attributes: product.attributes,
        supplierId: product.supplierId ? seedId(product.supplierId) : null,
        createdAt: utc(product.createdAt),
      })),
    )
    .onConflictDoNothing();
  if (fixtures.transfers.length > 0) {
    await tx
      .insert(transfers)
      .values(
        fixtures.transfers.map((transfer) => ({
          id: seedId(transfer.id),
          number: transfer.number,
          fromId: seedId(transfer.fromId),
          toId: seedId(transfer.toId),
          status: transfer.status,
          receivedAt: transfer.receivedAt ? utc(transfer.receivedAt) : null,
          receivedBy: userOf(transfer.receivedBy),
          note: transfer.note,
          createdAt: utc(transfer.createdAt),
          createdBy: userOf(transfer.createdBy),
        })),
      )
      .onConflictDoNothing();
  }
  // Parents first, so each remnant's parent row exists when it is inserted.
  const ordered = [...fixtures.rolls].sort((a, b) => Number(a.parentRollId !== null) - Number(b.parentRollId !== null));
  for (const roll of ordered) {
    await tx
      .insert(rolls)
      .values({
        id: seedId(roll.id),
        rollNumber: roll.rollNumber,
        productId: seedId(roll.productId),
        dyeLot: roll.dyeLot,
        widthFt: String(roll.widthFt),
        originalLengthFt: roll.originalLengthFt,
        remainingLengthFt: roll.remainingLengthFt,
        costPerSqFt: roll.costPerSqFt,
        locationId: seedId(roll.locationId),
        bin: roll.bin,
        transferId: roll.transferId ? seedId(roll.transferId) : null,
        isRemnant: roll.isRemnant,
        parentRollId: roll.parentRollId ? seedId(roll.parentRollId) : null,
        receivedAt: utc(roll.receivedAt),
      })
      .onConflictDoNothing();
    if (roll.cuts.length === 0) continue;
    await tx
      .insert(rollCuts)
      .values(
        roll.cuts.map((cut) => ({
          id: seedId(cut.id),
          rollId: seedId(roll.id),
          at: utc(cut.at),
          lengthFt: cut.lengthFt,
          reference: cut.reference,
          byUserId: userOf(cut.byUserId),
          sourceType: cut.source?.kind ?? null,
          sourceId: cut.source ? seedId(cut.source.id) : null,
          sourceNumber: cut.source?.number ?? null,
        })),
      )
      .onConflictDoNothing();
  }
  const lines = fixtures.transfers.flatMap((transfer) =>
    transfer.lines.map((line) => ({
      id: seedId(line.id),
      transferId: seedId(transfer.id),
      productId: seedId(line.productId),
      rollId: line.rollId ? seedId(line.rollId) : null,
      quantity: line.quantity,
    })),
  );
  if (lines.length > 0) await tx.insert(transferLines).values(lines).onConflictDoNothing();
  if (fixtures.stockMovements.length > 0) {
    await tx
      .insert(stockMovements)
      .values(
        fixtures.stockMovements.map((movement) => ({
          id: seedId(movement.id),
          at: utc(movement.at),
          productId: seedId(movement.productId),
          locationId: seedId(movement.locationId),
          quantity: movement.quantity,
          kind: movement.kind,
          sourceType: movement.source.kind,
          sourceId: seedId(movement.source.id),
          sourceNumber: movement.source.number,
          byUserId: userOf(movement.byUserId),
        })),
      )
      .onConflictDoNothing();
  }
}

/** The supplier directory (purchasing, part 1; ADR 0036), before products, which point at it. */
async function seedSuppliers(tx: CompanyDb, { fixtures }: DemoCompany): Promise<void> {
  if (fixtures.suppliers.length === 0) return;
  await tx
    .insert(suppliers)
    .values(
      fixtures.suppliers.map((supplier) => ({
        id: seedId(supplier.id),
        name: supplier.name,
        type: supplier.type,
        status: supplier.status,
        accountNumber: supplier.accountNumber,
        email: supplier.email,
        phone: supplier.phone,
        terms: supplier.terms,
        creditLimit: supplier.creditLimit,
        categories: supplier.categories,
        address: supplier.address,
        track1099: supplier.track1099,
        taxForm: supplier.taxForm,
        notes: supplier.notes,
        externalId: supplier.externalId ?? null,
      })),
    )
    .onConflictDoNothing();
  if (fixtures.supplierContacts.length === 0) return;
  await tx
    .insert(supplierContacts)
    .values(
      fixtures.supplierContacts.map((contact) => ({
        ...contact,
        id: seedId(contact.id),
        supplierId: seedId(contact.supplierId),
      })),
    )
    .onConflictDoNothing();
}

/** Purchase orders and goods receipts (purchasing, part 1), after the catalog they order. */
async function seedOrders(tx: CompanyDb, { fixtures }: DemoCompany): Promise<void> {
  // A database seeded before suppliers existed gets its products' supplier now.
  for (const product of fixtures.products) {
    if (!product.supplierId) continue;
    await tx
      .update(products)
      .set({ supplierId: seedId(product.supplierId) })
      .where(and(eq(products.id, seedId(product.id)), isNull(products.supplierId)));
  }
  for (const po of fixtures.purchaseOrders) {
    await tx
      .insert(purchaseOrders)
      .values({
        id: seedId(po.id),
        number: po.number,
        supplierId: seedId(po.supplierId),
        status: po.status,
        locationId: seedId(po.locationId),
        expectedAt: po.expectedAt,
        orderedAt: po.orderedAt ? utc(po.orderedAt) : null,
        cancelledAt: po.cancelledAt ? utc(po.cancelledAt) : null,
        total: po.total,
        contactId: po.contactId ? seedId(po.contactId) : null,
        contactSnapshot: po.contactSnapshot,
        supplierRef: po.supplierRef,
        buyerId: seededUserId(po.buyerId),
        placedVia: po.placedVia,
        createdAt: utc(po.createdAt),
        createdBy: seededUserId(po.buyerId),
      })
      .onConflictDoNothing();
    await tx
      .insert(poLines)
      .values(
        po.lines.map((line, position) => ({
          id: seedId(line.id),
          poId: seedId(po.id),
          position,
          productId: seedId(line.productId),
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitCost: line.unitCost,
          sqFtPerCarton: line.sqFtPerCarton ?? null,
          locationId: line.locationId ? seedId(line.locationId) : null,
        })),
      )
      .onConflictDoNothing();
  }
  for (const receipt of fixtures.receipts) {
    await tx
      .insert(goodsReceipts)
      .values({
        id: seedId(receipt.id),
        number: receipt.number,
        poId: seedId(receipt.poId),
        supplierId: seedId(receipt.supplierId),
        locationId: seedId(receipt.locationId),
        receivedAt: utc(receipt.receivedAt),
        receivedById: seededUserId(receipt.receivedById),
        note: receipt.note,
        createdBy: seededUserId(receipt.receivedById),
      })
      .onConflictDoNothing();
    await tx
      .insert(receiptLines)
      .values(
        receipt.lines.map((line, index) => ({
          id: seedId(`${receipt.id}:line:${index}`),
          receiptId: seedId(receipt.id),
          poLineId: seedId(line.poLineId),
          productId: seedId(line.productId),
          received: line.received,
          damaged: line.damaged,
          rolls: line.rolls,
          locationId: line.locationId ? seedId(line.locationId) : null,
        })),
      )
      .onConflictDoNothing();
  }
}

/**
 * Seeds the foundation of one company database: branches, locations, settings, tax rules,
 * numbering, roles, user profiles, and the catalog and stock (inventory, part 1). Business records
 * arrive module by module
 * (docs/real-build-plan.md), each with its own seed.
 */
export async function seedCompany(company: CompanyDb, demo: DemoCompany): Promise<void> {
  await company.transaction(async (tx) => {
    await seedOrganization(tx, demo);
    await seedAccess(tx, demo);
    await seedSuppliers(tx, demo);
    await seedCatalog(tx, demo);
    await seedOrders(tx, demo);
  });
}
