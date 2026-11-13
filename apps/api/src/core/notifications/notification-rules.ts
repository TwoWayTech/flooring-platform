import type { OutboxFailure, OutboxRecipient } from "@workspace/shared";

/** The address check of spec rule 4: a plain shape check, never a lookup. */
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Why an address cannot be emailed, or null when it can (spec rule 4, `failureOf`). */
export function addressProblem(email: string): { type: OutboxFailure; detail: string } | null {
  if (!email) return { type: "missing_email", detail: "no email address on file" };
  if (!EMAIL.test(email)) return { type: "invalid_email", detail: "that email address is not valid" };
  return null;
}

/**
 * The key that makes one send happen once (spec rule 3): event, source, version and recipient. The
 * same key is the Outbox row's unique key and the provider's idempotency key. pg-boss does not
 * deduplicate jobs; the worker's claim on the row keeps each row to one send (ADR 0032).
 */
export function dedupeKey(
  event: string,
  sourceId: string,
  version: string | undefined,
  recipient: Pick<OutboxRecipient, "kind" | "id">,
): string {
  return [event, sourceId, version ?? "", recipient.kind, recipient.id].join("|");
}

/** A header value on one line, so no value can add a header (PR #9 review). */
export function oneLine(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

/**
 * The From header: the company's sender name, quoted, on the platform's own address. Line breaks,
 * quotes, backslashes and angle brackets are removed from the name, so it cannot change the
 * address or add a header (PR #9 review).
 */
export function fromHeader(name: string, address: string): string {
  const safe = oneLine(name).replace(/["\\<>]/g, "");
  return safe ? `"${safe}" <${address}>` : address;
}

/** The text of a failure notice to the person who caused the message (spec rule 5). */
export function failureNotice(recipientName: string, detail: string | null): string {
  return `The email to ${recipientName} could not be delivered: ${detail ?? "unknown problem"}`;
}

/** An Outbox row as a reader sees it, before redaction. */
export interface OutboxView {
  actorUserId: string | null;
  recipientType: string;
  recipientId: string;
  recipientEmail: string;
  restricted: boolean;
  subject: string;
  bodyText: string;
  attachments: unknown[];
}

/** The person reading the Outbox, as the visibility rules need them. */
export interface OutboxReader {
  userId: string;
  email: string;
  /** Holds `settings.outbox.view`: may list every row. */
  admin: boolean;
  /** Holds `hr.employee.view`: may read restricted rows of others. */
  hrView: boolean;
}

/** Whether the reader is part of the message: who caused it, or who it went to (spec "Who can see"). */
function involves(row: OutboxView, reader: OutboxReader): boolean {
  return (
    row.actorUserId === reader.userId ||
    (row.recipientType === "user" && row.recipientId === reader.userId) ||
    row.recipientEmail.toLowerCase() === reader.email.toLowerCase()
  );
}

/**
 * The Outbox row as this reader may see it, or null when it is not listed for them (spec "Who can
 * see which Outbox row"): an admin sees every row, anyone else only their own; a restricted row of
 * someone else is redacted unless the reader holds `hr.employee.view`. Recipient, status and dates
 * stay visible on a redacted row.
 */
export function visibleOutboxRow<T extends OutboxView>(row: T, reader: OutboxReader): T | null {
  const mine = involves(row, reader);
  if (!reader.admin && !mine) return null;
  if (row.restricted && !mine && !reader.hrView) {
    return {
      ...row,
      subject: "Restricted message",
      bodyText: "Only the people involved can read this.",
      attachments: [],
    };
  }
  return row;
}
