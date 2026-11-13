import type { CompanySettings } from "@workspace/shared";
import type { CompanyDb } from "../client";
import {
  addresses,
  branches,
  customerContacts,
  customers,
  exemptionCertificates,
  invoiceCommissionSplits,
  invoiceLines,
  invoices,
  measurementRooms,
  paymentsReceived,
  reservations,
  quoteLines,
  quotes,
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
 * rolls with their cuts, and the boxed-stock ledger, with the seed's deterministic ids. Products
 * point at their supplier, which seedSuppliers writes first. Rows that point at an invoice or a
 * receipt store that document's `seedId` and number, so they match it once its module seeds it
 * with the same id (there is no foreign key).
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
      fixtures.supplierContacts.map((contact, index) => ({
        id: seedId(contact.id),
        supplierId: seedId(contact.supplierId),
        name: contact.name,
        role: contact.role,
        mobile: contact.mobile,
        officePhone: contact.officePhone,
        email: contact.email,
        whatsapp: contact.whatsapp,
        preferredMethod: contact.preferredMethod,
        notes: contact.notes,
        isPrimary: contact.isPrimary,
        status: contact.status,
        // The fixture lists each supplier's contacts oldest first; the "oldest active" rule reads this.
        createdAt: new Date(Date.UTC(2025, 0, 1) + index * 60_000),
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
          createdAt: utc(po.createdAt),
          createdBy: seededUserId(po.buyerId),
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
          createdAt: utc(receipt.receivedAt),
          createdBy: seededUserId(receipt.receivedById),
        })),
      )
      .onConflictDoNothing();
  }
}

/**
 * Customers with their addresses, contacts and exemption certificates, then quotes with their rooms
 * and lines (sales, part 1; ADR 0037). Default addresses are set once the addresses exist.
 */
async function seedSales(tx: CompanyDb, { fixtures }: DemoCompany): Promise<void> {
  const repOf = new Map(fixtures.customers.map((customer) => [customer.id, userOf(customer.salesRepId)]));
  for (const customer of fixtures.customers) {
    const id = seedId(customer.id);
    const by = repOf.get(customer.id) ?? null;
    const since = utc(customer.createdAt);
    await tx
      .insert(customers)
      .values({
        id,
        type: customer.type,
        name: customer.name,
        contactName: customer.contactName,
        email: customer.email,
        phone: customer.phone,
        terms: customer.terms,
        creditLimit: customer.creditLimit,
        taxExempt: customer.taxExempt,
        salesRepId: customer.salesRepId ? seededUserId(customer.salesRepId) : null,
        lifecycle: customer.lifecycle ?? "customer",
        externalId: customer.externalId ?? null,
        createdAt: since,
        createdBy: by,
      })
      .onConflictDoNothing();
    if (customer.addresses.length > 0) {
      await tx
        .insert(addresses)
        .values(
          customer.addresses.map((address, index) => ({
            id: seedId(address.id),
            // The fixture's order, kept: the first address is the fallback default.
            createdAt: new Date(since.getTime() + index * 1000),
            createdBy: by,
            customerId: id,
            label: address.label,
            street: address.street,
            city: address.city,
            state: address.state,
            zip: address.zip,
            county: address.county ?? null,
            lat: address.lat ?? null,
            lng: address.lng ?? null,
          })),
        )
        .onConflictDoNothing();
      await tx
        .update(customers)
        .set({
          defaultBillingId: customer.defaultBillingId ? seedId(customer.defaultBillingId) : null,
          defaultJobSiteId: customer.defaultJobSiteId ? seedId(customer.defaultJobSiteId) : null,
        })
        .where(and(eq(customers.id, id), isNull(customers.defaultBillingId)));
    }
    if (customer.certificate) {
      await tx
        .insert(exemptionCertificates)
        .values({
          id: seedId(`${customer.id}:certificate`),
          customerId: id,
          ...customer.certificate,
          createdAt: since,
          createdBy: by,
        })
        .onConflictDoNothing();
    }
  }
  if (fixtures.customerContacts.length > 0) {
    await tx
      .insert(customerContacts)
      .values(
        fixtures.customerContacts.map((contact) => ({
          id: seedId(contact.id),
          customerId: seedId(contact.customerId),
          name: contact.name,
          email: contact.email,
          phone: contact.phone,
          createdBy: repOf.get(contact.customerId) ?? null,
        })),
      )
      .onConflictDoNothing();
  }
  for (const quote of fixtures.quotes) {
    const id = seedId(quote.id);
    await tx
      .insert(quotes)
      .values({
        id,
        number: quote.number,
        customerId: seedId(quote.customerId),
        salesRepId: seededUserId(quote.salesRepId),
        branchId: seedId(quote.branchId),
        status: quote.status,
        sentAt: quote.sentAt ? utc(quote.sentAt) : null,
        expiresAt: quote.expiresAt,
        locationId: seedId(quote.locationId),
        soldAtLocationId: quote.soldAtLocationId ? seedId(quote.soldAtLocationId) : null,
        jobSite: quote.jobSite,
        depositPct: quote.depositPct,
        lumpSum: quote.lumpSum,
        taxOverride: quote.taxOverride,
        total: quote.total,
        notes: quote.notes,
        createdAt: utc(quote.createdAt),
        createdBy: seededUserId(quote.salesRepId),
      })
      .onConflictDoNothing();
    if (quote.rooms.length > 0) {
      await tx
        .insert(measurementRooms)
        .values(
          quote.rooms.map((room, index) => ({
            id: seedId(room.id),
            createdAt: new Date(utc(quote.createdAt).getTime() + index * 1000),
            createdBy: seededUserId(quote.salesRepId),
            quoteId: id,
            name: room.name,
            x: room.x,
            y: room.y,
            widthFt: String(room.widthFt),
            lengthFt: String(room.lengthFt),
          })),
        )
        .onConflictDoNothing();
    }
    if (quote.lines.length > 0) {
      await tx
        .insert(quoteLines)
        .values(
          quote.lines.map((line, position) => ({
            id: seedId(line.id),
            quoteId: id,
            position,
            productId: line.productId ? seedId(line.productId) : null,
            description: line.description,
            category: line.category,
            unit: line.unit,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            unitCost: line.unitCost,
            wastePct: line.wastePct ?? null,
            rollId: line.rollId ? seedId(line.rollId) : null,
            sqFtPerCarton: line.sqFtPerCarton ?? null,
            locationId: line.locationId ? seedId(line.locationId) : null,
            roomIds: (line.roomIds ?? []).map((roomId) => seedId(roomId)),
            createdAt: utc(quote.createdAt),
            createdBy: seededUserId(quote.salesRepId),
          })),
        )
        .onConflictDoNothing();
    }
  }
}

/**
 * Invoices with their lines, commission splits, customer payments and the stock they hold (sales,
 * part 2; ADR 0038). Fixture invoice lines reuse their quote line's id, so a line's id is
 * `seedId("invoice:" + id)`. Contract billing invoices wait for the contracts module, whose rows
 * they point at. Seeded proof files have no bytes, so payments are seeded without them.
 */
async function seedInvoices(tx: CompanyDb, { fixtures }: DemoCompany): Promise<void> {
  const billed = fixtures.invoices.filter((invoice) => !invoice.contractId);
  if (billed.length === 0) return;
  const kept = new Set(billed.map((invoice) => invoice.id));
  const lineId = (id: string) => seedId(`invoice:${id}`);
  const userByName = new Map(fixtures.users.map((person) => [person.name, seededUserId(person.id)]));
  for (const invoice of billed) {
    const id = seedId(invoice.id);
    const by = seededUserId(invoice.createdBy);
    const issuedAt = utc(invoice.issuedAt);
    await tx
      .insert(invoices)
      .values({
        id,
        number: invoice.number,
        quoteId: invoice.quoteId ? seedId(invoice.quoteId) : null,
        customerId: seedId(invoice.customerId),
        salesRepId: seededUserId(invoice.salesRepId),
        branchId: seedId(invoice.branchId),
        issuedAt,
        dueAt: invoice.dueAt,
        sentAt: invoice.sentAt ? utc(invoice.sentAt) : null,
        sentBy: userOf(invoice.sentBy),
        voidedAt: invoice.voidedAt ? utc(invoice.voidedAt) : null,
        voidReason: invoice.voidReason,
        depositPct: invoice.depositPct ?? "0",
        isReturn: invoice.isReturn,
        creditForInvoiceId: invoice.creditForInvoiceId ? seedId(invoice.creditForInvoiceId) : null,
        refundedAt: invoice.refundedAt ? utc(invoice.refundedAt) : null,
        locationId: seedId(invoice.locationId),
        soldAtLocationId: invoice.soldAtLocationId ? seedId(invoice.soldAtLocationId) : null,
        jobSite: invoice.jobSite,
        taxRule: invoice.taxRule,
        taxSource: invoice.taxSource,
        taxOverride: invoice.taxOverride,
        taxExempt: invoice.taxExempt,
        subtotal: invoice.subtotal,
        tax: invoice.tax,
        total: invoice.total,
        cost: invoice.cost,
        createdAt: issuedAt,
        createdBy: by,
      })
      .onConflictDoNothing();
    if (invoice.lines.length > 0) {
      await tx
        .insert(invoiceLines)
        .values(
          invoice.lines.map((line, position) => ({
            id: lineId(line.id),
            invoiceId: id,
            position,
            productId: line.productId ? seedId(line.productId) : null,
            description: line.description,
            category: line.category,
            unit: line.unit,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            unitCost: line.unitCost,
            wastePct: line.wastePct ?? null,
            rollId: line.rollId ? seedId(line.rollId) : null,
            sqFtPerCarton: line.sqFtPerCarton ?? null,
            locationId: line.locationId ? seedId(line.locationId) : null,
            createdAt: issuedAt,
            createdBy: by,
          })),
        )
        .onConflictDoNothing();
    }
    if (invoice.commissionSplit?.length) {
      await tx
        .insert(invoiceCommissionSplits)
        .values(
          invoice.commissionSplit.map((share) => ({
            id: seedId(`${invoice.id}:split:${share.userId}`),
            invoiceId: id,
            userId: seededUserId(share.userId),
            pct: share.pct,
            createdAt: issuedAt,
            createdBy: by,
          })),
        )
        .onConflictDoNothing();
    }
  }
  const payments = fixtures.payments.filter((payment) => kept.has(payment.invoiceId));
  if (payments.length > 0) {
    await tx
      .insert(paymentsReceived)
      .values(
        payments.map((payment) => ({
          id: seedId(payment.id),
          number: payment.number,
          invoiceId: seedId(payment.invoiceId),
          customerId: seedId(payment.customerId),
          kind: payment.kind,
          amount: payment.amount,
          date: payment.date,
          method: payment.method,
          checkNumber: payment.checkNumber,
          cardLast4: payment.cardLast4,
          reference: payment.reference,
          note: payment.note,
          status: payment.status,
          recordedById: seededUserId(payment.recordedById),
          recordedAt: utc(payment.recordedAt),
          reviewedById: payment.reviewedBy ? (userByName.get(payment.reviewedBy) ?? null) : null,
          reviewedAt: payment.reviewedAt ? utc(payment.reviewedAt) : null,
          rejectReason: payment.rejectReason,
          voidedById: payment.voidedBy ? (userByName.get(payment.voidedBy) ?? null) : null,
          voidedAt: payment.voidedAt ? utc(payment.voidedAt) : null,
          voidReason: payment.voidReason,
          createdAt: utc(payment.recordedAt),
          createdBy: seededUserId(payment.recordedById),
        })),
      )
      .onConflictDoNothing();
  }
  const held = fixtures.reservations.filter((reservation) => kept.has(reservation.invoiceId));
  if (held.length > 0) {
    await tx
      .insert(reservations)
      .values(
        held.map((reservation) => ({
          id: seedId(reservation.id),
          invoiceId: seedId(reservation.invoiceId),
          invoiceLineId: lineId(reservation.lineId),
          productId: seedId(reservation.productId),
          rollId: reservation.rollId ? seedId(reservation.rollId) : null,
          locationId: seedId(reservation.locationId),
          quantity: reservation.quantity,
          shortBy: reservation.shortBy,
          status: reservation.status,
          closedAt: reservation.closedAt ? utc(reservation.closedAt) : null,
          overrideReason: reservation.overrideReason,
          createdAt: utc(reservation.createdAt),
        })),
      )
      .onConflictDoNothing();
  }
}

/**
 * Seeds the foundation of one company database: branches, locations, settings, tax rules,
 * numbering, roles, user profiles, the supplier directory, the catalog and stock (inventory part 1),
 * and purchase orders with their receipts (purchasing part 1). Business records
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
    await seedSales(tx, demo);
    await seedInvoices(tx, demo);
  });
}
