import { meetingIcs } from "../../src/calendar/ics";
import { addDays } from "../../src/dates";
import type { Attendee, CompanyFixtures, CustomerContact, Meeting, OutboxMessage } from "../../src/types";
import type { GenContext } from "./context";
import { Rng } from "./random";

const uuid = (rng: Rng) => {
  const hex = (n: number) => Array.from({ length: n }, () => rng.int(0, 15).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
};

/** Fills in the email and response each invited guest has (ADR 0021), from their linked records. */
function withGuestDetails(f: CompanyFixtures, attendee: Attendee, rng: Rng): Attendee {
  const email =
    attendee.kind === "staff"
      ? f.users.find((u) => u.id === attendee.id)?.email
      : attendee.kind === "customer"
        ? f.customers.find((c) => c.id === attendee.id)?.email
        : f.suppliers.find((s) => s.id === attendee.id)?.email;
  return {
    ...attendee,
    email: email ?? "",
    role: "required",
    partStat: rng.chance(0.7) ? "accepted" : rng.chance(0.5) ? "tentative" : "needs-action",
    respondedAt: null,
    respondedSequence: 0,
    note: "",
    proposal: null,
  };
}

const base = (rng: Rng) => ({
  uid: uuid(rng),
  sequence: 0,
  rescheduleSequence: 0,
  status: "confirmed" as const,
  kind: "meeting" as const,
  private: false,
  hideGuestList: false,
  allowProposals: true,
});

/** One contact per commercial customer, so guest search finds people as well as companies (plan K-8). */
function buildContacts(ctx: GenContext, rng: Rng, f: CompanyFixtures): CustomerContact[] {
  return f.customers
    .filter((c) => c.type !== "homeowner")
    .slice(0, 12)
    .map((c) => {
      const name = rng.personName();
      return {
        id: ctx.id("ccon"),
        customerId: c.id,
        name,
        email: `${name.split(" ")[0]!.toLowerCase()}@${c.name.split(" ")[0]!.toLowerCase()}.example`,
        phone: rng.phone(ctx.company.areaCode),
      };
    });
}

/**
 * Adds to the seed what Batch E needs (spec G1): UIDs on every meeting, one with an external guest
 * and its invite in the Outbox, and one request waiting for an answer. On its own random stream.
 */
export function withMeetingRecords(ctx: GenContext, f: CompanyFixtures): CompanyFixtures {
  const rng = new Rng(ctx.company.seed + 17);
  const meetings: Meeting[] = f.meetings.map((m) => ({
    ...m,
    ...base(rng),
    attendees: m.attendees.map((a) => withGuestDetails(f, a, rng)),
  }));
  const contacts = buildContacts(ctx, rng, f);
  const owner = f.users[0]!;
  const peer = f.users.find((u, i) => i > 0 && u.status === "active") ?? owner;
  const guest: Attendee = {
    kind: "external",
    id: `ext-${ctx.company.idPrefix}-1`,
    name: "Riley Chen",
    email: "riley.chen@northfield-builders.example",
    role: "required",
    partStat: "needs-action",
    respondedAt: null,
    respondedSequence: null,
    note: "",
    proposal: null,
  };
  const self: Attendee = {
    kind: "staff",
    id: owner.id,
    name: owner.name,
    email: owner.email,
    role: "required",
    partStat: "accepted",
    respondedAt: null,
    respondedSequence: 0,
    note: "",
    proposal: null,
  };
  const external: Meeting = {
    ...base(rng),
    id: ctx.id("mtg"),
    title: "New build walkthrough",
    start: `${addDays(ctx.anchor, 2)}T10:30`,
    durationMin: 45,
    location: "Showroom",
    attendees: [self, guest],
    recurrence: "none",
    reminderMin: 30,
    ownerUserId: owner.id,
    notes: "",
    timeZone: meetings[0]?.timeZone ?? "America/New_York",
    until: null,
    exceptions: [],
    hideGuestList: true,
  };
  const request: Meeting = {
    ...base(rng),
    id: ctx.id("mtg"),
    title: "Review my goals",
    start: `${addDays(ctx.anchor, 3)}T14:00`,
    durationMin: 30,
    location: "Video call",
    attendees: [
      { ...self, id: peer.id, name: peer.name, email: peer.email },
      { ...self, partStat: "needs-action", respondedSequence: null },
    ],
    recurrence: "none",
    reminderMin: 15,
    ownerUserId: peer.id,
    notes: "Would like half an hour before the review cycle.",
    timeZone: external.timeZone,
    until: null,
    exceptions: [],
    status: "tentative",
    kind: "request",
  };
  const now = `${addDays(ctx.anchor, -1)}T09:15`;
  const text = meetingIcs({
    method: "REQUEST",
    meeting: external,
    sequence: 0,
    stamp: new Date(`${now}:00Z`),
    organizer: { name: owner.name, email: owner.email },
    attendees: [guest],
    status: "CONFIRMED",
  });
  const when = `${external.start.slice(0, 10)} at ${external.start.slice(11, 16)}`;
  const invite: OutboxMessage = {
    id: ctx.id("out"),
    eventKey: "meeting.invite",
    sourceType: "meeting",
    sourceId: external.id,
    actorUserId: owner.id,
    recipient: { kind: "guest", id: guest.id, name: guest.name, email: guest.email },
    fromName: f.settings.email.senderName,
    replyTo: f.settings.email.replyTo,
    subject: `Invitation: ${external.title}`,
    bodyText: `Invitation: ${external.title}\nWhen: ${when}\nWhere: ${external.location}\nOrganiser: ${owner.name}`,
    values: {
      "meeting.action": "Invitation",
      "meeting.title": external.title,
      "meeting.when": when,
      "meeting.location": external.location,
      "meeting.organiser": owner.name,
      "meeting.sequence": "0",
    },
    attachments: [{ kind: "ics", fileName: "New build walkthrough.ics", text }],
    status: "sent",
    failureType: null,
    failureDetail: null,
    createdAt: now,
    scheduledFor: null,
    sentAt: now,
    restricted: false,
    dedupeKey: `meeting.invite|${external.id}|seed`,
  };
  return {
    ...f,
    meetings: [...meetings, external, request],
    customerContacts: contacts,
    outboxMessages: [...f.outboxMessages, invite],
  };
}
