import type { OutboxReader } from "@workspace/shared";
import { describe, expect, it } from "vitest";
import {
  addressProblem,
  dedupeKey,
  emailAttachments,
  failureNotice,
  fromHeader,
  oneLine,
  visibleOutboxRow,
  type OutboxView,
} from "../src/core/notifications/notification-rules";

describe("addressProblem (spec rule 4)", () => {
  it("refuses a missing or malformed address and accepts a plain one", () => {
    expect(addressProblem("")?.type).toBe("missing_email");
    expect(addressProblem("dana@")?.type).toBe("invalid_email");
    expect(addressProblem("dana rivera@example.test")?.type).toBe("invalid_email");
    expect(addressProblem("dana@example.test")).toBeNull();
  });
});

describe("dedupeKey (spec rule 3: one row per send)", () => {
  it("joins event, source, version and recipient, so only a new version sends again", () => {
    const recipient = { kind: "customer" as const, id: "c1" };
    expect(dedupeKey("quote.sent", "q1", undefined, recipient)).toBe("quote.sent|q1||customer|c1");
    expect(dedupeKey("quote.sent", "q1", "2", recipient)).not.toBe(dedupeKey("quote.sent", "q1", undefined, recipient));
  });
});

describe("failureNotice (spec rule 5)", () => {
  it("names the recipient and the reason", () => {
    expect(failureNotice("Dana", null)).toBe("The email to Dana could not be delivered: unknown problem");
  });
});

describe("visibleOutboxRow (spec: who can see which Outbox row)", () => {
  const row: OutboxView = {
    sourceType: "commission",
    actorUserId: "actor",
    recipientType: "customer",
    recipientId: "c1",
    recipientEmail: "Dana@Example.test",
    restricted: true,
    subject: "Your commission",
    bodyText: "Details",
    attachments: [{ kind: "pdf" }],
  };
  const reader = (overrides: Partial<OutboxReader>): OutboxReader => ({
    userId: "someone",
    email: "someone@example.test",
    admin: false,
    hrView: false,
    ...overrides,
  });

  it("lists a row only to the people involved, or to an Outbox admin", () => {
    expect(visibleOutboxRow(row, reader({}))).toBeNull();
    expect(visibleOutboxRow(row, reader({ userId: "actor" }))).toEqual(row);
    expect(visibleOutboxRow(row, reader({ email: "dana@example.test" }))).toEqual(row);
  });

  it("redacts someone else's restricted row for an admin without hr.employee.view", () => {
    expect(visibleOutboxRow(row, reader({ admin: true }))).toMatchObject({
      subject: "Restricted message",
      bodyText: "Only the people involved can read this.",
      attachments: [],
      recipientEmail: "Dana@Example.test",
    });
    expect(visibleOutboxRow(row, reader({ admin: true, hrView: true }))).toEqual(row);
  });

  it("redacts a private meeting's row for everyone not involved, the Owner with hr.employee.view included (ADR 0051)", () => {
    const meeting: OutboxView = {
      ...row,
      sourceType: "meeting",
      subject: "Invitation: Review with Ana",
      attachments: [{ kind: "ics", text: "BEGIN:VCALENDAR" }],
    };
    expect(visibleOutboxRow(meeting, reader({ admin: true, hrView: true }))).toMatchObject({
      subject: "Restricted message",
      attachments: [],
    });
    expect(visibleOutboxRow(meeting, reader({ admin: true, hrView: true, userId: "actor" }))).toEqual(meeting);
    expect(visibleOutboxRow(meeting, reader({ email: "dana@example.test" }))).toEqual(meeting);
    expect(visibleOutboxRow({ ...meeting, restricted: false }, reader({ admin: true }))).toEqual({
      ...meeting,
      restricted: false,
    });
  });
});

describe("emailAttachments (ADR 0051: the .ics goes with the email)", () => {
  const ics = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nMETHOD:REQUEST\r\nEND:VCALENDAR\r\n";

  it("sends an .ics as UTF-8 bytes with its iTIP method in the content type", () => {
    const [file] = emailAttachments([{ kind: "ics", fileName: "Site visit.ics", text: ics }]);
    expect(file?.contentType).toBe("text/calendar; method=REQUEST; charset=UTF-8");
    expect(file?.content).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(file?.content as Uint8Array)).toBe(ics);
    expect(file?.fileName).toBe("Site visit.ics");
  });

  it("names no method it does not know, and keeps a file name on one safe line", () => {
    const [file] = emailAttachments([
      { kind: "ics", fileName: 'a"b/\\c\r\nBcc: x.ics', text: "BEGIN:VCALENDAR\r\nMETHOD:EVIL\r\n" },
    ]);
    expect(file?.contentType).toBe("text/calendar; charset=UTF-8");
    expect(file?.fileName).toBe("abc Bcc: x.ics");
  });

  it("leaves out a PDF kept only as a link, and an .ics with no text", () => {
    expect(
      emailAttachments([
        { kind: "pdf", fileName: "Q-1001.pdf", href: "/quotes/1" },
        { kind: "ics", fileName: "empty.ics" },
      ]),
    ).toEqual([]);
  });
});

describe("fromHeader and oneLine (PR #9 review: no header injection)", () => {
  it("keeps a sender name on one line, without quotes or angle brackets, on the platform's address", () => {
    expect(fromHeader('Summit "Floor" <evil@x.test>\r\nBcc: all@x.test', "no-reply@summit.test")).toBe(
      '"Summit Floor evil@x.test Bcc: all@x.test" <no-reply@summit.test>',
    );
    expect(fromHeader("\r\n", "no-reply@summit.test")).toBe("no-reply@summit.test");
  });

  it("puts a subject on one line", () => {
    expect(oneLine("Quote\r\nBcc: all@x.test")).toBe("Quote Bcc: all@x.test");
  });
});
