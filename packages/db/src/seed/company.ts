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
  billReceipts,
  changeOrderLines,
  changeOrders,
  contractBillingLines,
  contractBillingReleases,
  contractBillings,
  contractLines,
  contracts,
  insuranceCertificates,
  insuranceCoverages,
  lienWaivers,
  expenses,
  paymentAllocations,
  paymentsMade,
  recurringExpenses,
  supplierBills,
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
import { seedHr } from "./hr";
import { userOf, utc } from "./values";

/** Settings groups as stored: branding lives in the control database, tax rules and county rates in their own tables. */
function settingsRows(companyId: string, value: CompanySettings) {
  const { branding, localization, ...rest } = value;
  const { rules, jurisdictions, ...tax } = localization.tax;
  // Accounting is not seeded: a company without the row uses DEFAULT_ACCOUNTING_SETTINGS (ADR 0040).
  const groups: Record<Exclude<SettingsGroup, "accounting">, unknown> = {
    ...rest,
    localization: { ...localization, tax },
  };
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
    // The employee link is set by seedHr, once the employees exist.
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
 * part 2; ADR 0038). Contract billing invoices point at their billing, so seedContractBillings
 * writes them once the billings exist (ADR 0045).
 */
async function seedInvoices(tx: CompanyDb, { fixtures }: DemoCompany): Promise<void> {
  await insertInvoices(
    tx,
    fixtures,
    fixtures.invoices.filter((invoice) => !invoice.contractId),
  );
}

/**
 * Writes some fixture invoices with their lines, commission splits, payments and holds. Fixture
 * invoice lines reuse their quote line's id, so a line's id is `seedId("invoice:" + id)`. Seeded
 * proof files have no bytes, so payments are seeded without them.
 */
async function insertInvoices(
  tx: CompanyDb,
  fixtures: DemoCompany["fixtures"],
  billed: DemoCompany["fixtures"]["invoices"],
): Promise<void> {
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
        contractId: invoice.contractId ? seedId(invoice.contractId) : null,
        billingId: invoice.billingId ? seedId(invoice.billingId) : null,
        retainageWithheld: invoice.retainageWithheld ?? null,
        retainageReleased: invoice.retainageReleased ?? null,
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
  // A hold is made by issuing its invoice, so the invoice's author made it.
  const authorOf = new Map(billed.map((invoice) => [invoice.id, seededUserId(invoice.createdBy)]));
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
          createdBy: authorOf.get(reservation.invoiceId) ?? null,
        })),
      )
      .onConflictDoNothing();
  }
}

/**
 * Expenses and recurring expenses (P12 part 2; ADR 0041), with the supplier bills that pay-later
 * expenses link to; the other bills arrive with P12 part 3. Seeded history posts no journal entry:
 * the ledger starts at go-live (STATUS, "Opening balances"). Seeded receipts have no bytes, so no
 * attachment rows are written (ADR 0038). A raised recurring draft keeps no creator, so the list
 * shows "Recurring expense" until a person saves it.
 */
async function seedExpenses(tx: CompanyDb, { fixtures }: DemoCompany): Promise<void> {
  const byName = new Map(fixtures.users.map((user) => [user.name, user.id]));
  const owner = fixtures.users.find((user) => user.roleIds.some((role) => role.endsWith("-owner")));
  const linked = new Set(fixtures.expenses.flatMap((expense) => (expense.billId ? [expense.billId] : [])));
  for (const bill of fixtures.bills.filter((row) => linked.has(row.id))) {
    await tx
      .insert(supplierBills)
      .values({
        id: seedId(bill.id),
        number: bill.number,
        supplierId: seedId(bill.supplierId),
        poId: bill.poId ? seedId(bill.poId) : null,
        issuedAt: bill.issuedAt,
        dueAt: bill.dueAt,
        total: bill.total,
        matchIssues: bill.matchIssues,
        createdBy: userOf(owner?.id),
      })
      .onConflictDoNothing();
  }
  for (const template of fixtures.recurringExpenses) {
    await tx
      .insert(recurringExpenses)
      .values({
        id: seedId(template.id),
        supplierId: seedId(template.supplierId),
        category: template.category,
        locationId: template.locationId ? seedId(template.locationId) : null,
        amount: template.amount,
        tax: template.tax,
        paymentMethod: template.paymentMethod,
        frequency: template.frequency,
        dayOfMonth: template.dayOfMonth,
        startsOn: template.startsOn,
        endsOn: template.endsOn,
        active: template.active,
        note: template.note,
        createdBy: userOf(owner?.id),
      })
      .onConflictDoNothing();
  }
  for (const expense of fixtures.expenses) {
    const raised = expense.recurringId !== null && expense.recordedBy === "Recurring expense";
    await tx
      .insert(expenses)
      .values({
        id: seedId(expense.id),
        number: expense.number,
        date: expense.date,
        supplierId: expense.supplierId ? seedId(expense.supplierId) : null,
        category: expense.category,
        locationId: expense.locationId ? seedId(expense.locationId) : null,
        amount: expense.amount,
        tax: expense.tax,
        paymentMethod: expense.paymentMethod,
        reference: expense.reference,
        note: expense.note,
        status: expense.status,
        settlement: expense.settlement,
        dueAt: expense.dueAt,
        billId: expense.billId ? seedId(expense.billId) : null,
        recurringId: expense.recurringId ? seedId(expense.recurringId) : null,
        period: expense.period,
        recordedById: seededUserId(expense.recordedById),
        recordedAt: utc(expense.recordedAt),
        reviewedById: userOf(expense.reviewedBy ? byName.get(expense.reviewedBy) : null),
        reviewedAt: expense.reviewedAt ? utc(expense.reviewedAt) : null,
        rejectReason: expense.rejectReason,
        voidedById: userOf(expense.voidedBy ? byName.get(expense.voidedBy) : null),
        voidedAt: expense.voidedAt ? utc(expense.voidedAt) : null,
        voidReason: expense.voidReason,
        createdAt: utc(expense.recordedAt),
        createdBy: raised ? null : seededUserId(expense.recordedById),
      })
      .onConflictDoNothing();
  }
}

/**
 * Supplier bills for received goods, with their receipts, and supplier payments with their
 * allocations (P12 part 3; ADR 0042). Bills a pay-later expense raised are seeded with expenses;
 * subcontract bills point at their billing, so seedContractBillings writes them, and any payment
 * that pays one, once the billings exist (ADR 0045). Seeded history posts no journal entry (the
 * ledger starts at go-live), and seeded files have no bytes.
 */
async function seedPayables(tx: CompanyDb, { fixtures }: DemoCompany): Promise<void> {
  const expenseBills = new Set(fixtures.expenses.flatMap((expense) => (expense.billId ? [expense.billId] : [])));
  const bills = fixtures.bills.filter((bill) => !bill.contractId && !expenseBills.has(bill.id));
  await insertBills(tx, fixtures, bills);
  await insertSupplierPayments(tx, fixtures, new Set([...expenseBills, ...bills.map((bill) => bill.id)]));
}

/** The user who enters seeded bills: the company's owner. */
function billAuthor(fixtures: DemoCompany["fixtures"]): string | null {
  return userOf(fixtures.users.find((user) => user.roleIds.some((role) => role.endsWith("-owner")))?.id);
}

/** Writes some fixture bills with their receipts and, on a subcontract bill, its billing's figures. */
async function insertBills(
  tx: CompanyDb,
  fixtures: DemoCompany["fixtures"],
  bills: DemoCompany["fixtures"]["bills"],
): Promise<void> {
  const author = billAuthor(fixtures);
  for (const bill of bills) {
    await tx
      .insert(supplierBills)
      .values({
        id: seedId(bill.id),
        number: bill.number,
        supplierId: seedId(bill.supplierId),
        poId: bill.poId ? seedId(bill.poId) : null,
        issuedAt: bill.issuedAt,
        dueAt: bill.dueAt,
        total: bill.total,
        matchIssues: bill.matchIssues,
        contractId: bill.contractId ? seedId(bill.contractId) : null,
        billingId: bill.billingId ? seedId(bill.billingId) : null,
        kind: bill.kind ?? null,
        gross: bill.gross ?? null,
        retainageWithheld: bill.retainageWithheld ?? null,
        retainageReleased: bill.retainageReleased ?? null,
        createdBy: author,
      })
      .onConflictDoNothing();
    for (const receiptId of bill.receiptIds) {
      await tx
        .insert(billReceipts)
        .values({
          id: seedId(`${bill.id}:receipt:${receiptId}`),
          billId: seedId(bill.id),
          receiptId: seedId(receiptId),
          createdBy: author,
        })
        .onConflictDoNothing();
    }
  }
}

/** Writes the fixture supplier payments whose every allocation pays a bill in `seeded`. */
async function insertSupplierPayments(
  tx: CompanyDb,
  fixtures: DemoCompany["fixtures"],
  seeded: ReadonlySet<string>,
): Promise<void> {
  const byName = new Map(fixtures.users.map((user) => [user.name, user.id]));
  for (const payment of fixtures.supplierPayments) {
    if (!payment.allocations.every((entry) => seeded.has(entry.billId))) continue;
    await tx
      .insert(paymentsMade)
      .values({
        id: seedId(payment.id),
        number: payment.number,
        supplierId: seedId(payment.supplierId),
        date: payment.date,
        method: payment.method,
        reference: payment.reference,
        note: payment.note,
        amount: payment.amount,
        status: payment.status,
        recordedById: seededUserId(payment.recordedById),
        recordedAt: utc(payment.recordedAt),
        reviewedById: userOf(payment.reviewedBy ? byName.get(payment.reviewedBy) : null),
        reviewedAt: payment.reviewedAt ? utc(payment.reviewedAt) : null,
        rejectReason: payment.rejectReason,
        voidedById: userOf(payment.voidedBy ? byName.get(payment.voidedBy) : null),
        voidedAt: payment.voidedAt ? utc(payment.voidedAt) : null,
        voidReason: payment.voidReason,
        createdAt: utc(payment.recordedAt),
        createdBy: seededUserId(payment.recordedById),
      })
      .onConflictDoNothing();
    for (const [index, entry] of payment.allocations.entries()) {
      await tx
        .insert(paymentAllocations)
        .values({
          id: seedId(`${payment.id}:allocation:${index}`),
          paymentId: seedId(payment.id),
          billId: seedId(entry.billId),
          amount: entry.amount,
          createdAt: utc(payment.recordedAt),
          createdBy: seededUserId(payment.recordedById),
        })
        .onConflictDoNothing();
    }
  }
}

/**
 * Contracts, part 1 (ADR 0044): contracts with their schedule lines, change orders with their
 * rows and certificates of insurance with their coverages. Billings with their documents
 * (seedContractBillings) and lien waivers (seedWaivers, after the payments they cite) follow.
 * Seeded signed PDFs have no bytes, so contract files are not seeded.
 */
async function seedContracts(tx: CompanyDb, { fixtures }: DemoCompany): Promise<void> {
  const byName = new Map(fixtures.users.map((user) => [user.name, user.id]));
  const ref = (id: string | null) => (id ? seedId(id) : null);
  const creatorOf = new Map(fixtures.contracts.map((contract) => [contract.id, seededUserId(contract.salesRepId)]));
  for (const contract of fixtures.contracts) {
    await tx
      .insert(contracts)
      .values({
        id: seedId(contract.id),
        number: contract.number,
        direction: contract.direction,
        kind: contract.kind,
        masterId: ref(contract.masterId),
        customerId: ref(contract.customerId),
        supplierId: ref(contract.supplierId),
        parentContractId: ref(contract.parentContractId),
        title: contract.title,
        scope: contract.scope,
        branchId: seedId(contract.branchId),
        locationId: seedId(contract.locationId),
        jobSite: contract.jobSite,
        salesRepId: seededUserId(contract.salesRepId),
        startsAt: contract.startsAt,
        endsAt: contract.endsAt,
        renewalMode: contract.renewal.mode,
        renewalNoticeDays: contract.renewal.noticeDays,
        renewedFromId: ref(contract.renewedFromId),
        originalValue: contract.originalValue,
        retainagePct: contract.retainagePct,
        storedRetainagePct: contract.storedRetainagePct,
        bondInLieu: contract.bondInLieu,
        taxTreatment: contract.taxTreatment,
        status: contract.status,
        sentAt: contract.sentAt ? utc(contract.sentAt) : null,
        signedAt: contract.signedAt ? utc(contract.signedAt) : null,
        signature: contract.signature,
        substantialCompletionAt: contract.substantialCompletionAt,
        finalAcceptanceAt: contract.finalAcceptanceAt,
        terminatedAt: contract.terminatedAt ? utc(contract.terminatedAt) : null,
        terminationReason: contract.terminationReason,
        closeOverrideReason: contract.closeOverrideReason,
        notes: contract.notes,
        createdBy: creatorOf.get(contract.id),
      })
      .onConflictDoNothing();
  }
  // Lines a change order added point at it, so change orders go in first, then lines, then their rows.
  for (const order of fixtures.changeOrders) {
    await tx
      .insert(changeOrders)
      .values({
        id: seedId(order.id),
        number: order.number,
        contractId: seedId(order.contractId),
        status: order.status,
        reason: order.reason,
        submittedAt: order.submittedAt ? utc(order.submittedAt) : null,
        decidedAt: order.decidedAt ? utc(order.decidedAt) : null,
        decidedById: userOf(order.decidedBy ? byName.get(order.decidedBy) : null),
        decisionReason: order.decisionReason,
        createdBy: creatorOf.get(order.contractId),
      })
      .onConflictDoNothing();
  }
  for (const line of fixtures.contractLines) {
    await tx
      .insert(contractLines)
      .values({
        id: seedId(line.id),
        contractId: seedId(line.contractId),
        code: line.code,
        description: line.description,
        category: line.category,
        billing: line.billing,
        scheduledValue: line.scheduledValue,
        retainagePct: line.retainagePct,
        storedRetainagePct: line.storedRetainagePct,
        milestoneDueAt: line.milestoneDueAt,
        changeOrderId: ref(line.changeOrderId),
        estimatedCost: line.estimatedCost,
        createdBy: creatorOf.get(line.contractId),
      })
      .onConflictDoNothing();
  }
  for (const order of fixtures.changeOrders) {
    for (const [index, row] of order.lines.entries()) {
      await tx
        .insert(changeOrderLines)
        .values({
          id: seedId(`${order.id}:line:${index}`),
          changeOrderId: seedId(order.id),
          contractLineId: ref(row.lineId),
          description: row.description,
          category: row.category,
          amountDelta: row.amountDelta,
          createdBy: creatorOf.get(order.contractId),
        })
        .onConflictDoNothing();
    }
  }
  for (const certificate of fixtures.insuranceCertificates) {
    await tx
      .insert(insuranceCertificates)
      .values({
        id: seedId(certificate.id),
        supplierId: seedId(certificate.supplierId),
        contractId: seedId(certificate.contractId),
        producer: certificate.producer,
        holder: certificate.holder,
        additionalInsured: certificate.additionalInsured,
        createdBy: creatorOf.get(certificate.contractId),
      })
      .onConflictDoNothing();
    for (const [index, coverage] of certificate.coverages.entries()) {
      await tx
        .insert(insuranceCoverages)
        .values({
          id: seedId(`${certificate.id}:coverage:${index}`),
          certificateId: seedId(certificate.id),
          ...coverage,
          createdBy: creatorOf.get(certificate.contractId),
        })
        .onConflictDoNothing();
    }
  }
}

/**
 * Contract billings, part 2 (ADR 0045): billings with their cumulative lines and release shares,
 * then the invoices (with their payments) and subcontract bills (with any supplier payment that
 * pays one) they raised, then each billing's link to its document. A billing and its document
 * point at each other, so the billing goes in first without the link. Seeded history posts no
 * journal entry: the ledger starts at go-live (STATUS, "Opening balances").
 */
async function seedContractBillings(tx: CompanyDb, { fixtures }: DemoCompany): Promise<void> {
  const byName = new Map(fixtures.users.map((user) => [user.name, user.id]));
  for (const billing of fixtures.contractBillings) {
    const by = userOf(byName.get(billing.postedBy)) ?? billAuthor(fixtures);
    const postedAt = utc(billing.postedAt);
    await tx
      .insert(contractBillings)
      .values({
        id: seedId(billing.id),
        contractId: seedId(billing.contractId),
        number: billing.number,
        kind: billing.kind,
        periodEnd: billing.periodEnd,
        status: billing.status,
        gross: billing.gross,
        withheld: billing.withheld,
        released: billing.released,
        postedAt,
        postedById: by!,
        createdAt: postedAt,
        createdBy: by,
      })
      .onConflictDoNothing();
    for (const [index, line] of billing.lines.entries()) {
      await tx
        .insert(contractBillingLines)
        .values({
          id: seedId(`${billing.id}:line:${index}`),
          billingId: seedId(billing.id),
          contractLineId: seedId(line.lineId),
          completedToDate: line.completedToDate,
          storedBalance: line.storedBalance,
          retainagePct: line.retainagePct,
          storedRetainagePct: line.storedRetainagePct,
          createdAt: postedAt,
          createdBy: by,
        })
        .onConflictDoNothing();
    }
    for (const [index, release] of billing.releases.entries()) {
      await tx
        .insert(contractBillingReleases)
        .values({
          id: seedId(`${billing.id}:release:${index}`),
          billingId: seedId(billing.id),
          contractLineId: seedId(release.lineId),
          amount: release.amount,
          createdAt: postedAt,
          createdBy: by,
        })
        .onConflictDoNothing();
    }
  }
  await insertInvoices(
    tx,
    fixtures,
    fixtures.invoices.filter((invoice) => invoice.contractId),
  );
  await insertBills(
    tx,
    fixtures,
    fixtures.bills.filter((bill) => bill.contractId),
  );
  // Every bill is seeded now, so a payment that pays a subcontract bill goes in too.
  await insertSupplierPayments(tx, fixtures, new Set(fixtures.bills.map((bill) => bill.id)));
  for (const billing of fixtures.contractBillings) {
    if (!billing.invoiceId && !billing.billId) continue;
    await tx
      .update(contractBillings)
      .set({
        invoiceId: billing.invoiceId ? seedId(billing.invoiceId) : null,
        billId: billing.billId ? seedId(billing.billId) : null,
      })
      .where(eq(contractBillings.id, seedId(billing.id)));
  }
}

/**
 * Lien waivers (ADR 0044), after every payment they may cite is seeded. A waiver whose payment is
 * still missing from the seed is left out rather than pointing at nothing.
 */
async function seedWaivers(tx: CompanyDb, { fixtures }: DemoCompany): Promise<void> {
  const payments = new Set(fixtures.payments.map((payment) => payment.id));
  const supplierPayments = new Set(fixtures.supplierPayments.map((payment) => payment.id));
  const ref = (id: string | null) => (id ? seedId(id) : null);
  const creatorOf = new Map(fixtures.contracts.map((contract) => [contract.id, seededUserId(contract.salesRepId)]));
  const waivers = fixtures.lienWaivers.filter(
    (waiver) =>
      (!waiver.paymentId || payments.has(waiver.paymentId)) &&
      (!waiver.supplierPaymentId || supplierPayments.has(waiver.supplierPaymentId)),
  );
  for (const waiver of waivers) {
    await tx
      .insert(lienWaivers)
      .values({
        id: seedId(waiver.id),
        contractId: seedId(waiver.contractId),
        direction: waiver.direction,
        type: waiver.type,
        paymentId: ref(waiver.paymentId),
        supplierPaymentId: ref(waiver.supplierPaymentId),
        amount: waiver.amount,
        throughDate: waiver.throughDate,
        state: waiver.state,
        statutoryForm: waiver.statutoryForm,
        signedOn: waiver.signedOn,
        status: waiver.status,
        createdBy: creatorOf.get(waiver.contractId),
      })
      .onConflictDoNothing();
  }
}

/**
 * Seeds the foundation of one company database: branches, locations, settings, tax rules,
 * numbering, roles, user profiles, the supplier directory, the catalog and stock (inventory part 1),
 * purchase orders with their receipts (purchasing part 1), expenses (P12 part 2), bills and
 * supplier payments (P12 part 3), contracts with their billings (contracts parts 1 and 2), and HR
 * people, timesheets and time off (HR part 1).
 * Business records arrive module by module (docs/real-build-plan.md), each with its own seed.
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
    await seedExpenses(tx, demo);
    await seedPayables(tx, demo);
    await seedContracts(tx, demo);
    await seedContractBillings(tx, demo);
    await seedWaivers(tx, demo);
    await seedHr(tx, demo);
  });
}
