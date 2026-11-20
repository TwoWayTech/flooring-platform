import type { EmailAttachment } from "@workspace/providers";
import {
  outboxSight,
  REDACTED_OUTBOX,
  type OutboxAttachment,
  type OutboxFailure,
  type OutboxReader,
  type OutboxRecipient,
} from "@workspace/shared";

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
  sourceType: string;
  actorUserId: string | null;
  recipientType: string;
  recipientId: string;
  recipientEmail: string;
  restricted: boolean;
  subject: string;
  bodyText: string;
  attachments: unknown[];
}

/**
 * The Outbox row as this reader may see it, or null when it is not listed for them: the shared
 * `outboxSight` (spec "Who can see which Outbox row"; ADR 0051), which DemoStore applies too. A
 * redacted row keeps its recipient, status and dates and loses its subject, body and attachments.
 */
export function visibleOutboxRow<T extends OutboxView>(row: T, reader: OutboxReader): T | null {
  const sight = outboxSight({ ...row, recipientKind: row.recipientType }, reader);
  if (sight === "hidden") return null;
  if (sight === "redacted") return { ...row, ...REDACTED_OUTBOX, attachments: [] };
  return row;
}

/** The iTIP methods a calendar attachment may name (RFC 5546 section 1.4). */
const ITIP_METHODS = new Set(["PUBLISH", "REQUEST", "REPLY", "ADD", "CANCEL", "REFRESH", "COUNTER", "DECLINECOUNTER"]);

/** The METHOD line of a calendar file, when it is one RFC 5546 defines. */
function calendarMethod(text: string): string | null {
  const method = /^METHOD:([A-Z]+)\r?$/m.exec(text)?.[1];
  return method && ITIP_METHODS.has(method) ? method : null;
}

/** An attachment's file name as a header carries it: one line, without quotes, slashes or control characters. */
function attachmentName(fileName: string): string {
  const safe = oneLine(fileName)
    .replace(/[\u0000-\u001f\u007f"\\/]/g, "")
    .slice(0, 120);
  return safe || "attachment";
}

/**
 * The files an Outbox row's email carries (ADR 0051 "Invites"; notifications.md "Attachments"). An
 * .ics goes as UTF-8 bytes, because the Resend adapter reads a string as base64 and would corrupt
 * plain text; its content type names the iTIP method, as RFC 6047 section 2.4 asks, so a mail
 * client can offer the invite. A PDF kept only as a link has no bytes here and is left out: the
 * email's text carries the link.
 */
export function emailAttachments(attachments: readonly OutboxAttachment[]): EmailAttachment[] {
  const encoder = new TextEncoder();
  return attachments.flatMap((attachment) => {
    if (attachment.kind !== "ics" || !attachment.text) return [];
    const method = calendarMethod(attachment.text);
    return [
      {
        fileName: attachmentName(attachment.fileName),
        content: encoder.encode(attachment.text),
        contentType: method ? `text/calendar; method=${method}; charset=UTF-8` : "text/calendar; charset=UTF-8",
      },
    ];
  });
}

/**
 * The template value that holds when a message stops being worth sending (ADR 0051 "Reminder
 * expiry"). It lives in the row's values, which are never returned to readers, so no column is added.
 */
export const EXPIRES_AT_VALUE = "outbox.expiresAt";
