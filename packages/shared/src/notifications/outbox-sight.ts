/**
 * What an Outbox row's sight rule reads: who caused it, who it went to, its source and whether it
 * is restricted. The API's rows and DemoStore's carry these under their own names.
 */
export interface OutboxSightRow {
  sourceType: string;
  actorUserId: string | null;
  recipientKind: string;
  recipientId: string;
  recipientEmail: string;
  restricted: boolean;
}

/** The person reading the Outbox, as the sight rule needs them. */
export interface OutboxReader {
  userId: string;
  email: string;
  /** Reads the whole company's Outbox: asked for it and holds `settings.outbox.view` (spec `admin = all && can`). */
  admin: boolean;
  /** Holds `hr.employee.view`: may read restricted rows of others, except a private meeting's. */
  hrView: boolean;
}

/** What a redacted row shows instead of its subject and body (spec "Who can see which Outbox row"). */
export const REDACTED_OUTBOX = {
  subject: "Restricted message",
  bodyText: "Only the people involved can read this.",
} as const;

/** Whether the reader is part of the message: who caused it, or who it went to, the address compared without case. */
function involves(row: OutboxSightRow, reader: OutboxReader): boolean {
  return (
    row.actorUserId === reader.userId ||
    (row.recipientKind === "user" && row.recipientId === reader.userId) ||
    (row.recipientEmail !== "" && row.recipientEmail.toLowerCase() === reader.email.toLowerCase())
  );
}

/**
 * Whether a restricted row stays sealed even for holders of `hr.employee.view`: a private meeting's
 * invite, reminder or reply. A private meeting is hidden from everyone who is not on it, the Owner
 * included (meetings.md "Who sees which meeting"; ADR 0051 "Private meetings", critic A4), and its
 * rows carry its title, notes, place and guests. Meeting rows are restricted only when the meeting
 * is private.
 */
function sealed(row: OutboxSightRow): boolean {
  return row.restricted && row.sourceType === "meeting";
}

/**
 * How a reader sees one Outbox row (spec "Who can see which Outbox row"; ADR 0032, ADR 0051): not
 * listed (`hidden`) unless they read the whole company's Outbox or are part of it; `redacted` (no
 * subject, body or attachments; recipient, status and dates stay) when it is restricted, they are
 * not part of it, and they lack `hr.employee.view` or it is a private meeting's; otherwise `whole`.
 * The API's `GET /outbox` and DemoStore's `listOutbox` both apply it, so both modes show the same rows
 * (ADR 0059, bell and Outbox part, D2).
 */
export function outboxSight(row: OutboxSightRow, reader: OutboxReader): "hidden" | "redacted" | "whole" {
  const mine = involves(row, reader);
  if (!reader.admin && !mine) return "hidden";
  if (row.restricted && !mine && (!reader.hrView || sealed(row))) return "redacted";
  return "whole";
}
