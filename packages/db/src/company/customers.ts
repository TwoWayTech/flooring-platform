import type { CustomerAddressLabel, CustomerType, PaymentTerms } from "@workspace/shared";
import { boolean, doublePrecision, pgTable, text, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { business, day, money, userRef } from "../columns";

/** A customer account or a lead (spec sales.md). Credit limit is sensitive. */
export const customers = pgTable("customers", {
  ...business(),
  type: text().$type<CustomerType>().notNull(),
  name: text().notNull(),
  contactName: text().notNull().default(""),
  email: text().notNull().default(""),
  phone: text().notNull().default(""),
  defaultBillingId: uuid().references((): AnyPgColumn => addresses.id),
  defaultJobSiteId: uuid().references((): AnyPgColumn => addresses.id),
  terms: text().$type<PaymentTerms>().notNull(),
  creditLimit: money().notNull().default("0"),
  taxExempt: boolean().notNull().default(false),
  salesRepId: userRef(),
  lifecycle: text().$type<"customer" | "lead">().notNull().default("customer"),
  externalId: text(),
});

/**
 * A labelled customer address (ADR 0011). The county picks the tax jurisdiction; coordinates come
 * from address suggestions and are display hints, not money, so a float is fine.
 */
export const addresses = pgTable("addresses", {
  ...business(),
  customerId: uuid()
    .notNull()
    .references(() => customers.id),
  label: text().$type<CustomerAddressLabel>().notNull(),
  street: text().notNull(),
  city: text().notNull(),
  state: text().notNull(),
  zip: text().notNull(),
  county: text(),
  lat: doublePrecision(),
  lng: doublePrecision(),
});

/** A person at a customer (plan K-8); can be a meeting guest. */
export const customerContacts = pgTable("customer_contacts", {
  ...business(),
  customerId: uuid()
    .notNull()
    .references(() => customers.id),
  name: text().notNull(),
  email: text().notNull().default(""),
  phone: text().notNull().default(""),
});

/** A resale or exemption certificate on file; the file itself is an attachment. */
export const exemptionCertificates = pgTable("exemption_certificates", {
  ...business(),
  customerId: uuid()
    .notNull()
    .references(() => customers.id),
  number: text().notNull(),
  state: text().notNull(),
  expiresAt: day().notNull(),
});
