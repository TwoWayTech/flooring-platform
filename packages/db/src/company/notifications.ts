import type {
  NotificationChannels,
  NotificationEventKey,
  OutboxAttachment,
  OutboxFailure,
  OutboxRecipient,
  OutboxStatus,
} from "@workspace/shared";
import { boolean, index, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";
import { at, business, userRef } from "../columns";

/** A company's choices for one event; with no row, the catalogue's defaults apply (ADR 0020). */
export const notificationRules = pgTable(
  "notification_rules",
  {
    ...business(),
    eventKey: text().$type<NotificationEventKey>().notNull(),
    enabled: boolean().notNull(),
    channels: jsonb().$type<NotificationChannels>().notNull(),
    subject: text().notNull(),
    body: text().notNull(),
  },
  (table) => [uniqueIndex("notification_rules_event_uidx").on(table.eventKey)],
);

/**
 * One email per recipient, so a single failure names who failed (ADR 0020). Subject, body and
 * attachments are snapshots. The worker (pg-boss, later) sends queued rows through the
 * EmailProvider with dedupe_key as the idempotency key. Source and recipient are polymorphic links.
 */
export const outboxMessages = pgTable(
  "outbox_messages",
  {
    ...business(),
    eventKey: text().$type<NotificationEventKey>().notNull(),
    sourceType: text().notNull(),
    sourceId: text().notNull(),
    actorUserId: userRef(),
    recipientType: text().$type<OutboxRecipient["kind"]>().notNull(),
    recipientId: text().notNull(),
    recipientName: text().notNull(),
    recipientEmail: text().notNull(),
    fromName: text().notNull(),
    replyTo: text().notNull().default(""),
    subject: text().notNull(),
    bodyText: text().notNull(),
    values: jsonb().$type<Record<string, string>>().notNull().default({}),
    attachments: jsonb().$type<OutboxAttachment[]>().notNull().default([]),
    status: text().$type<OutboxStatus>().notNull(),
    failureType: text().$type<OutboxFailure>(),
    failureDetail: text(),
    scheduledFor: at(),
    sentAt: at(),
    providerMessageId: text(),
    restricted: boolean().notNull().default(false),
    dedupeKey: text().notNull(),
  },
  (table) => [
    uniqueIndex("outbox_messages_dedupe_uidx").on(table.dedupeKey),
    index("outbox_messages_status_idx").on(table.status, table.scheduledFor),
  ],
);

/** A stored in-app notification for one person, with read state (blueprint "notifications"). */
export const notifications = pgTable(
  "notifications",
  {
    ...business(),
    userId: userRef().notNull(),
    eventKey: text().$type<NotificationEventKey>().notNull(),
    title: text().notNull(),
    href: text().notNull(),
    readAt: at(),
  },
  (table) => [index("notifications_user_idx").on(table.userId, table.readAt)],
);
