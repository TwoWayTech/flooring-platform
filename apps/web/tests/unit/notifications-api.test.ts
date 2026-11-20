import { describe, expect, it } from "vitest";
import type { OutboxRowWire } from "@/lib/api/http/outbox-answer";
import { fakeApi } from "./fake-api";

const ID = "0195f3a2-7b1c-7d4e-8f00-00000000aa01";
const OTHER = "0195f3a2-7b1c-7d4e-8f00-00000000aa02";

/** One Outbox row as GET /outbox answers it. */
function wire(over: Partial<OutboxRowWire> = {}): OutboxRowWire {
  return {
    id: ID,
    eventKey: "invoice.sent",
    sourceType: "invoice",
    sourceId: OTHER,
    actorUserId: OTHER,
    recipientType: "customer",
    recipientId: OTHER,
    recipientName: "Dana Rivera",
    recipientEmail: "dana@rivera.example",
    fromName: "Summit Floor Co.",
    replyTo: "office@summit.example",
    subject: "Invoice INV-1001",
    bodyText: "Hello",
    attachments: [],
    status: "failed",
    failureType: "provider_error",
    failureDetail: "the email service did not accept the message",
    restricted: false,
    scheduledFor: null,
    sentAt: null,
    createdAt: "2026-11-20T09:00:00.000Z",
    ...over,
  };
}

/**
 * The bell and the Outbox in api mode (ADR 0059, the bell and Outbox part, D1 to D3): the routed
 * methods, what they send and how the answer becomes the screens' rows.
 */
describe("the bell and the Outbox in api mode", () => {
  it("NA1 the bell reads GET /notifications", async () => {
    const note = {
      id: ID,
      userId: OTHER,
      eventKey: "timeoff.requested",
      title: "T",
      href: "/hr",
      createdAt: "x",
      readAt: null,
    };
    const api = fakeApi({ "GET /notifications": { status: 200, body: [note] } });
    expect(await api.client.listMyNotifications()).toEqual([note]);
    expect(api.calls()).toEqual(["GET /notifications"]);
  });

  it("NA2 marking read sends only API ids, nothing for an empty list, and batches of 200", async () => {
    const empty = fakeApi();
    await empty.client.markNotificationsRead([]);
    await empty.client.markNotificationsRead(["ntf-demo-1"]);
    // An empty body would mark every unread note of the person's read on the API.
    expect(empty.sent).toEqual([]);
    const many = Array.from({ length: 250 }, (_, i) => `0195f3a2-7b1c-7d4e-8f00-${String(i).padStart(12, "0")}`);
    const api = fakeApi();
    await api.client.markNotificationsRead([...many, "ntf-demo-1"]);
    expect(api.sent.map((s) => s.call)).toEqual(["POST /notifications/read", "POST /notifications/read"]);
    expect((api.sent[0]!.body as { ids: string[] }).ids).toEqual(many.slice(0, 200));
    expect((api.sent[1]!.body as { ids: string[] }).ids).toEqual(many.slice(200));
  });

  it("NA3 the Outbox asks for the whole company only with `all`, and maps a row to the screens' shape", async () => {
    const api = fakeApi({
      "GET /outbox": { status: 200, body: [wire({ id: OTHER })] },
      "GET /outbox?all=true": { status: 200, body: [wire()] },
    });
    const [all] = await api.client.listOutbox(true);
    expect(all).toMatchObject({
      id: ID,
      recipient: { kind: "customer", id: OTHER, name: "Dana Rivera", email: "dana@rivera.example" },
      fromName: "Summit Floor Co.",
      replyTo: "office@summit.example",
      values: {},
      dedupeKey: "",
      status: "failed",
    });
    expect(all).not.toHaveProperty("recipientEmail");
    expect((await api.client.listOutbox(false)).map((m) => m.id)).toEqual([OTHER]);
    expect(api.calls()).toEqual(["GET /outbox", "GET /outbox?all=true"]);
  });

  it("NA4 a switched-off Outbox (404) is an empty list; a refusal still fails", async () => {
    const off = fakeApi({
      "GET /outbox?all=true": { status: 404, body: { code: "not_found", message: "Not found." } },
    });
    expect(await off.client.listOutbox(true)).toEqual([]);
    const refused = fakeApi({ "GET /outbox": { status: 403, body: { code: "forbidden", message: "No." } } });
    await expect(refused.client.listOutbox(false)).rejects.toThrow("No.");
  });

  it("NA5 Send again and Cancel post to the row's route and answer the row as listed; a demo id sends nothing", async () => {
    for (const action of ["retry", "cancel"] as const) {
      const api = fakeApi({ "GET /outbox?all=true": { status: 200, body: [wire({ status: "queued" })] } });
      const row = await (action === "retry" ? api.client.retryOutbox(ID) : api.client.cancelOutbox(ID));
      expect(row.status).toBe("queued");
      expect(api.sent.map((s) => s.call)).toEqual([`POST /outbox/${ID}/${action}`, "GET /outbox?all=true"]);
      const demo = fakeApi();
      await expect(demo.client.retryOutbox("out-demo-1")).rejects.toThrow("This message no longer exists.");
      expect(demo.sent).toEqual([]);
    }
  });

  it("NA6 a refused Send again shows the API's words", async () => {
    const api = fakeApi({
      [`POST /outbox/${ID}/retry`]: {
        status: 403,
        body: { code: "forbidden", message: "Your role does not allow this." },
      },
    });
    await expect(api.client.retryOutbox(ID)).rejects.toThrow("Your role does not allow this.");
  });
});
