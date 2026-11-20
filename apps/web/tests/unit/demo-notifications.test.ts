import { describe, expect, it } from "vitest";
import { EMAIL_MESSAGES, messageMoney, REDACTED_OUTBOX, type Invoice, type OutboxMessage } from "@workspace/shared";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

/** Summit's Owner, Sales rep and HR manager. */
const DANA = "sm-usr-01";
const PRIYA = "sm-usr-03";
const TAMARA = "sm-usr-07";
const ROLE_REFUSAL = "Your role does not allow this. Ask an Owner to change your security role.";

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

/** A fresh demo store with Summit open for one person. */
async function open(userId: string): Promise<DemoStore> {
  const store = new DemoStore(noFiles);
  await store.openCompany("summit", { userId, viewAsRoleId: null });
  return store;
}

/** The store's own collections, behind the screens' back: the test writes the rows it needs. */
interface StoreDb {
  put(collection: "outboxMessages", row: OutboxMessage): OutboxMessage;
  put(collection: "invoices", row: Invoice): Invoice;
}

/** Writes Outbox rows straight into one store. */
function rows(store: DemoStore) {
  const db = (store as unknown as { open(): StoreDb }).open();
  return { put: (row: OutboxMessage) => db.put("outboxMessages", row) };
}

/** One of Summit's invoices made unsent again (every seeded invoice was sent), so Mark as sent emails it. */
async function unsentInvoice(store: DemoStore): Promise<Invoice> {
  const invoice = (await store.list("invoices")).find((i) => !i.voidedAt)!;
  const db = (store as unknown as { open(): StoreDb }).open();
  return db.put("invoices", { ...invoice, sentAt: null, sentBy: null });
}

/** A failed or scheduled Outbox row, caused by `actor`. */
function row(over: Partial<OutboxMessage>): OutboxMessage {
  return {
    id: `out-test-${Math.random().toString(36).slice(2)}`,
    eventKey: "quote.sent",
    sourceType: "quote",
    sourceId: "q-test",
    actorUserId: PRIYA,
    recipient: { kind: "customer", id: "c-test", name: "Dana Rivera", email: "dana@rivera.example" },
    fromName: "Summit",
    replyTo: "",
    subject: "Your quote",
    bodyText: "Hello",
    values: {},
    attachments: [],
    status: "failed",
    failureType: "invalid_email",
    failureDetail: "that email address is not valid",
    createdAt: "2026-11-20T09:00",
    scheduledFor: null,
    sentAt: null,
    restricted: false,
    dedupeKey: `test|${Math.random()}`,
    ...over,
  };
}

/**
 * DemoStore's bell, Outbox and Settings → Email follow the API's rules (ADR 0059, the bell and Outbox
 * part): money in messages through `messageMoney`, Send again and Cancel only with
 * settings.outbox.view, the shared sight rule, and Settings → Email's key, scope and words.
 */
describe("DemoStore notifications and Settings → Email (ADR 0059, bell and Outbox part)", () => {
  it("DN1 an invoice email writes its total in the company's number format, with one currency sign", async () => {
    const store = await open(DANA);
    const invoice = await unsentInvoice(store);
    await store.markInvoiceSent(invoice.id);
    const [message] = (await store.listOutbox(true)).filter(
      (m) => m.sourceId === invoice.id && m.eventKey === "invoice.sent",
    );
    const numbers = (await store.getSettings()).numbers;
    const total = messageMoney(invoice.total, numbers);
    expect(total.startsWith("$")).toBe(true);
    expect(message?.values["invoice.total"]).toBe(total);
    expect(message?.bodyText).toContain(` for ${total} is attached.`);
    expect(message?.bodyText).not.toContain("$$");
  });

  it("DN2 Send again and Cancel need settings.outbox.view, even on one's own row, as on the API (D3)", async () => {
    const priya = await open(PRIYA);
    const failed = rows(priya).put(row({ actorUserId: PRIYA }));
    const scheduled = rows(priya).put(
      row({
        actorUserId: PRIYA,
        status: "scheduled",
        failureType: null,
        failureDetail: null,
        scheduledFor: "2099-01-01T09:00",
      }),
    );
    // Her own rows are listed to her, but she can't act on them.
    const own = (await priya.listOutbox(false)).map((m) => m.id);
    expect(own).toEqual(expect.arrayContaining([failed.id, scheduled.id]));
    await expect(priya.retryOutbox(failed.id)).rejects.toThrow(ROLE_REFUSAL);
    await expect(priya.cancelOutbox(scheduled.id)).rejects.toThrow(ROLE_REFUSAL);
    // The Owner holds the key and acts on any row.
    const dana = await open(DANA);
    const theirs = rows(dana).put(row({ actorUserId: PRIYA }));
    const waiting = rows(dana).put(
      row({
        actorUserId: PRIYA,
        status: "scheduled",
        failureType: null,
        failureDetail: null,
        scheduledFor: "2099-01-01T09:00",
      }),
    );
    // Sent again after the address is checked once more (spec `retryOutbox`).
    expect((await dana.retryOutbox(theirs.id)).status).toBe("sent");
    expect((await dana.cancelOutbox(waiting.id)).status).toBe("cancelled");
  });

  it("DN3 the sight rule is the API's: own rows only without `all`; a private meeting's row is redacted even for hr.employee.view", async () => {
    const dana = await open(DANA);
    const meeting = rows(dana).put(
      row({
        actorUserId: PRIYA,
        sourceType: "meeting",
        eventKey: "meeting.invite",
        restricted: true,
        subject: "Private: offer",
      }),
    );
    const commission = rows(dana).put(
      row({
        actorUserId: PRIYA,
        sourceType: "commission",
        eventKey: "commission.ready",
        restricted: true,
        subject: "Statement",
      }),
    );
    // Without `all` even the Owner sees only her own rows.
    expect((await dana.listOutbox(false)).some((m) => m.id === meeting.id)).toBe(false);
    const all = await dana.listOutbox(true);
    expect(all.find((m) => m.id === meeting.id)).toMatchObject({ ...REDACTED_OUTBOX, attachments: [] });
    // The Owner holds hr.employee.view, which opens a restricted row that is not a private meeting's.
    expect(all.find((m) => m.id === commission.id)?.subject).toBe("Statement");
    // The person who caused it reads it whole; the address is compared without case.
    const priya = await open(PRIYA);
    rows(priya).put(meeting);
    expect((await priya.listOutbox(false)).find((m) => m.id === meeting.id)?.subject).toBe("Private: offer");
    const tamara = await open(TAMARA);
    const addressed = rows(tamara).put(
      row({
        actorUserId: DANA,
        recipient: { kind: "customer", id: "x", name: "Tamara", email: "TAMARA.REYES@summitfloor.example" },
      }),
    );
    expect((await tamara.listOutbox(false)).some((m) => m.id === addressed.id)).toBe(true);
  });

  it("DN4 Settings → Email: the Owner saves; the shared words refuse; nobody else holds the key", async () => {
    const dana = await open(DANA);
    const email = (await dana.getSettings()).email;
    const audits = (await dana.list("audit")).length;
    await expect(dana.updateSettings("email", { ...email, replyTo: "office" })).rejects.toThrow(EMAIL_MESSAGES.replyTo);
    await expect(dana.updateSettings("email", { ...email, senderName: "A <b@c.co>" })).rejects.toThrow(
      EMAIL_MESSAGES.senderNameCharacters,
    );
    expect(await dana.list("audit")).toHaveLength(audits);
    const seen = new Set((await dana.list("audit")).map((entry) => entry.id));
    const value = { ...email, replyTo: "billing@summitfloor.example" };
    await dana.updateSettings("email", value);
    expect((await dana.getSettings()).email).toEqual(value);
    const added = (await dana.list("audit")).filter((entry) => !seen.has(entry.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ category: "settings", action: "Changed email and notifications" });
    for (const userId of [PRIYA, TAMARA]) {
      const store = await open(userId);
      await expect(store.updateSettings("email", value)).rejects.toThrow(ROLE_REFUSAL);
    }
  });

  it("DN5 an empty sender name sends as the company, as on the API (D10)", async () => {
    const dana = await open(DANA);
    const settings = await dana.getSettings();
    await dana.updateSettings("email", { ...settings.email, senderName: "" });
    const invoice = await unsentInvoice(dana);
    await dana.markInvoiceSent(invoice.id);
    const [message] = (await dana.listOutbox(true)).filter((m) => m.sourceId === invoice.id);
    expect(message?.fromName).toBe(settings.branding.displayName);
  });
});
