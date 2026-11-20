import type { OutboxMessage } from "@workspace/shared";
import { ApiError } from "../errors";
import { HttpApiError, type HttpTransport } from "./transport";

/**
 * One Outbox row as `GET /outbox` answers it (ADR 0032; ADR 0059, bell and Outbox part, D2): the
 * screen's columns and the sender snapshot, flat. Template values, the dedupe key and the provider's
 * id never come, so a redacted row can't be read back through them.
 */
export interface OutboxRowWire {
  id: string;
  eventKey: OutboxMessage["eventKey"];
  sourceType: string;
  sourceId: string;
  actorUserId: string | null;
  recipientType: OutboxMessage["recipient"]["kind"];
  recipientId: string;
  recipientName: string;
  recipientEmail: string;
  fromName: string;
  replyTo: string;
  subject: string;
  bodyText: string;
  attachments: OutboxMessage["attachments"];
  /** The API's statuses: the screen's, and `sending` while the worker holds the row. */
  status: OutboxMessage["status"];
  failureType: OutboxMessage["failureType"];
  failureDetail: string | null;
  restricted: boolean;
  scheduledFor: string | null;
  sentAt: string | null;
  createdAt: string;
}

/**
 * An Outbox row as the screens read it. The recipient becomes one object; `values` is empty, because
 * the API never sends them (the template preview falls back to its samples), and so is the dedupe key.
 */
export function outboxFromWire(row: OutboxRowWire): OutboxMessage {
  return {
    id: row.id,
    eventKey: row.eventKey,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    actorUserId: row.actorUserId,
    recipient: { kind: row.recipientType, id: row.recipientId, name: row.recipientName, email: row.recipientEmail },
    fromName: row.fromName,
    replyTo: row.replyTo,
    subject: row.subject,
    bodyText: row.bodyText,
    values: {},
    attachments: row.attachments,
    status: row.status,
    failureType: row.failureType,
    failureDetail: row.failureDetail,
    createdAt: row.createdAt,
    scheduledFor: row.scheduledFor,
    sentAt: row.sentAt,
    restricted: row.restricted,
    dedupeKey: "",
  };
}

/**
 * The Outbox as this person reads it: the whole company's with `all` (the API lists every row only
 * when asked and the person holds settings.outbox.view), otherwise their own. A switched-off Outbox
 * (404) is an empty list, so Settings → Email's template preview still opens with its samples.
 */
export async function readOutbox(http: HttpTransport, all: boolean): Promise<OutboxMessage[]> {
  try {
    const rows = await http.request<OutboxRowWire[]>("GET", all ? "/outbox?all=true" : "/outbox");
    return rows.map(outboxFromWire);
  } catch (failure) {
    if (failure instanceof HttpApiError && failure.status === 404) return [];
    throw failure;
  }
}

/** The words for an Outbox row the API doesn't hold, DemoStore's own. */
const NO_MESSAGE = "This message no longer exists.";

/** Whether an id can name an API row (UUID); a demo row's id can't, so nothing is sent for it. */
function isRowId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

/**
 * Send again or Cancel message on one row (`POST /outbox/:id/retry|cancel`, settings.outbox.view on
 * the API; ADR 0059, bell and Outbox part, D3), then the row as the whole company's Outbox now
 * shows it, which is what the contract answers.
 */
export async function outboxAction(
  http: HttpTransport,
  id: string,
  action: "retry" | "cancel",
): Promise<OutboxMessage> {
  if (!isRowId(id)) throw new ApiError(NO_MESSAGE);
  await http.request<unknown>("POST", `/outbox/${id}/${action}`);
  const row = (await readOutbox(http, true)).find((message) => message.id === id);
  if (!row) throw new ApiError(NO_MESSAGE);
  return row;
}

/** The most ids one `POST /notifications/read` takes (its Zod body). */
const READ_BATCH = 200;

/**
 * Marks the person's own notes read (`POST /notifications/read`), in batches the API takes. Only ids
 * that can name an API note are sent, and an empty list sends nothing: the API reads a body without
 * ids as "every unread note of mine", while the contract's empty list means none (ADR 0059, bell and
 * Outbox part, D1).
 */
export async function markRead(http: HttpTransport, ids: readonly string[]): Promise<void> {
  const saved = ids.filter(isRowId);
  for (let start = 0; start < saved.length; start += READ_BATCH)
    await http.request<unknown>("POST", "/notifications/read", { ids: saved.slice(start, start + READ_BATCH) });
}
