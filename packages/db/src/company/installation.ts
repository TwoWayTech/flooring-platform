import type { Address, JobStatus, SellUnit } from "@workspace/shared";
import { integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { at, business, day, money, quantity, userRef } from "../columns";
import { customers } from "./customers";
import { invoices } from "./sales";

/**
 * Installation is switched off (feature `installation.calendar`, status removed) but its data is
 * kept, so its tables stay in the schema (data-model.md, Installation). A crew is W-2 staff or a
 * 1099 subcontractor.
 */
export const crews = pgTable("crews", {
  ...business(),
  name: text().notNull(),
  kind: text().$type<"crew" | "subcontractor">().notNull(),
  leadUserId: userRef(),
  members: text().array().notNull().default([]),
  phone: text().notNull().default(""),
});

/** An installation job with its costing; margin is sensitive. */
export const jobs = pgTable(
  "jobs",
  {
    ...business(),
    number: text().notNull(),
    customerId: uuid()
      .notNull()
      .references(() => customers.id),
    invoiceId: uuid().references(() => invoices.id),
    crewId: uuid()
      .notNull()
      .references(() => crews.id),
    date: day().notNull(),
    startHour: integer().notNull(),
    durationHours: integer().notNull(),
    status: text().$type<JobStatus>().notNull(),
    address: jsonb().$type<Address>().notNull(),
    scope: text().notNull().default(""),
    laborHours: quantity().notNull(),
    laborCost: money().notNull(),
    revenue: money().notNull(),
    signedOffAt: at(),
    signedBy: text(),
    notes: text().notNull().default(""),
  },
  (table) => [uniqueIndex("jobs_number_uidx").on(table.number)],
);

/** Material used on a job. */
export const jobMaterials = pgTable("job_materials", {
  ...business(),
  jobId: uuid()
    .notNull()
    .references(() => jobs.id),
  description: text().notNull(),
  quantity: quantity().notNull(),
  unit: text().$type<SellUnit>().notNull(),
  cost: money().notNull(),
});

/** A photo taken on a job; the image is an attachment. */
export const jobPhotos = pgTable("job_photos", {
  ...business(),
  jobId: uuid()
    .notNull()
    .references(() => jobs.id),
  caption: text().notNull().default(""),
  attachmentId: uuid(),
});
