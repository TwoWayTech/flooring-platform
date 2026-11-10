/** Sender details the company controls (spec A4); the real build's From address stays on a verified domain. */
export interface EmailSettings {
  senderName: string;
  replyTo: string;
  signature: string;
}

/** Every event the system can notify about (spec A4, ADR 0020). */
export type NotificationEventKey =
  | "quote.sent"
  | "invoice.sent"
  | "payment.receipt"
  | "payment.to_verify"
  | "po.sent"
  | "timesheet.submitted"
  | "timesheet.decided"
  | "timeoff.requested"
  | "timeoff.decided"
  | "commission.ready"
  | "meeting.invite"
  | "meeting.reminder"
  | "meeting.reply"
  | "meeting.proposed"
  | "meeting.requested"
  | "contract.signature"
  | "contract.expiring"
  | "milestone.invoiced"
  | "delivery.failed";

/** Where an event is delivered. */
export interface NotificationChannels {
  email: boolean;
  inApp: boolean;
}

/** A company's choices for one event; with none, the catalogue's defaults apply (ADR 0020). */
export interface NotificationRule {
  /** The event key; one rule per event. */
  id: NotificationEventKey;
  enabled: boolean;
  channels: NotificationChannels;
  subject: string;
  body: string;
  updatedAt: string;
  updatedBy: string;
}

/** What an Outbox row is on its way to doing (ADR 0020). The demo never sends real email. */
export type OutboxStatus = "scheduled" | "queued" | "sent" | "failed" | "cancelled";

/** Why a row failed. */
export type OutboxFailure = "missing_email" | "invalid_email" | "provider_error" | "bounced";

/** Who a message is for. */
export interface OutboxRecipient {
  kind: "user" | "customer" | "customer_contact" | "supplier_contact" | "supplier" | "guest";
  id: string;
  name: string;
  email: string;
}

/** A file a message would carry: a document link, or calendar text kept inline. */
export interface OutboxAttachment {
  kind: "pdf" | "ics";
  fileName: string;
  /** Where the document opens, for a PDF. */
  href?: string;
  /** The file's text, for an .ics. */
  text?: string;
}

/**
 * One email the system would send, per recipient, so a single failure names who failed. Subject,
 * body and attachments are snapshots: editing a template later never rewrites what was "sent".
 */
export interface OutboxMessage {
  id: string;
  eventKey: NotificationEventKey;
  sourceType: string;
  sourceId: string;
  actorUserId: string | null;
  recipient: OutboxRecipient;
  fromName: string;
  replyTo: string;
  subject: string;
  bodyText: string;
  /** The values the template was filled with, for a real preview (ADR 0020). */
  values: Record<string, string>;
  attachments: OutboxAttachment[];
  status: OutboxStatus;
  failureType: OutboxFailure | null;
  failureDetail: string | null;
  createdAt: string;
  scheduledFor: string | null;
  sentAt: string | null;
  /** Rows carrying pay, commission or a private meeting show only recipient and status to others. */
  restricted: boolean;
  /** Stops a second row for the same send. */
  dedupeKey: string;
}

/** A stored notification for one person, with read state (ADR 0020). */
export interface InAppNotification {
  id: string;
  userId: string;
  eventKey: NotificationEventKey;
  title: string;
  href: string;
  createdAt: string;
  readAt: string | null;
}
