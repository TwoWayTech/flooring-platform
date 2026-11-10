import {
  addMinutes,
  attendeeConflicts,
  featureOn,
  meetingIcs,
  moveOccurrence,
  recurrenceProblem,
  type Attendee,
  type Customer,
  type Meeting,
  type MeetingResponse,
  type OutboxRecipient,
} from "@workspace/shared";
import type { MeetingInput, MeetingMove, MeetingRequestInput, MeetingUndo, NewGuest, ReplyInput } from "../contract";
import { DemoRuleError } from "./admin-rules";
import { inAppFor, notify } from "./notification-actions";
import type { ActionContext } from "./payment-actions";

function need(ctx: ActionContext, id: string): Meeting {
  const meeting = ctx.db.get("meetings", id);
  if (!meeting) throw new DemoRuleError("This meeting no longer exists.");
  return meeting;
}

const organizerOf = (ctx: ActionContext, meeting: Meeting) => {
  const owner = ctx.db.get("users", meeting.ownerUserId);
  return { name: owner?.name ?? "Organiser", email: owner?.email ?? "" };
};

const RECIPIENT_KIND: Record<Attendee["kind"], OutboxRecipient["kind"]> = {
  staff: "user",
  customer: "customer",
  supplier: "supplier",
  "customer-contact": "customer_contact",
  "supplier-contact": "supplier_contact",
  external: "guest",
};

const whenText = (start: string) => `${start.slice(0, 10)} at ${start.slice(11, 16)}`;

/** One Outbox row and one calendar file per guest (ADR 0021). With a hidden guest list, each file names only its recipient. */
function sendToGuests(
  ctx: ActionContext,
  meeting: Meeting,
  opts: {
    recipients: readonly Attendee[];
    method: "REQUEST" | "CANCEL" | "DECLINECOUNTER";
    action: string;
    sequence: number;
    status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
    listed?: readonly Attendee[];
    recurrenceId?: string;
    start?: string;
    durationMin?: number;
  },
) {
  if (!featureOn("meetings.invites")) return;
  const organizer = organizerOf(ctx, meeting);
  const start = opts.start ?? meeting.start;
  for (const guest of opts.recipients) {
    if (guest.kind === "staff" && guest.id === meeting.ownerUserId) continue;
    const listed = meeting.hideGuestList ? [guest] : (opts.listed ?? meeting.attendees);
    const text = meetingIcs({
      method: opts.method,
      meeting,
      sequence: opts.sequence,
      stamp: new Date(),
      organizer,
      attendees: listed.filter((a) => a.email),
      status: opts.status,
      recurrenceId: opts.recurrenceId,
      start: opts.start,
      durationMin: opts.durationMin,
    });
    notify(ctx, {
      key: "meeting.invite",
      source: { type: "meeting", id: meeting.id, href: "/meetings" },
      values: {
        "meeting.action": opts.action,
        "meeting.title": meeting.title,
        "meeting.when": whenText(start),
        "meeting.location": meeting.location,
        "meeting.organiser": organizer.name,
        "meeting.sequence": String(opts.sequence),
      },
      to: [{ kind: RECIPIENT_KIND[guest.kind], id: guest.id, name: guest.name, email: guest.email }],
      attachments: [{ kind: "ics", fileName: `${meeting.title.replace(/[^\w ]+/g, "")}.ics`, text }],
      inApp: guest.kind === "staff" ? [{ userId: guest.id, title: `${opts.action}: ${meeting.title}` }] : undefined,
      version: `${opts.sequence}-${opts.method}-${ctx.now}-${opts.recurrenceId ?? ""}`,
      restricted: meeting.private,
    });
  }
}

/** Sets who is told when a meeting's reminder is due; held in the Outbox until then (spec E). */
function scheduleReminder(ctx: ActionContext, meeting: Meeting) {
  const scheduledFor = addMinutes(meeting.start, -meeting.reminderMin);
  if (scheduledFor <= ctx.now) return;
  const staff = meeting.attendees.filter((a) => a.kind === "staff");
  notify(ctx, {
    key: "meeting.reminder",
    source: { type: "meeting", id: meeting.id, href: "/meetings" },
    values: {
      "meeting.title": meeting.title,
      "meeting.when": whenText(meeting.start),
      "meeting.location": meeting.location,
    },
    to: staff.map((a) => ({ kind: "user" as const, id: a.id, name: a.name, email: a.email })),
    scheduledFor,
    version: `${meeting.sequence}-reminder`,
    restricted: meeting.private,
  });
}

/** Saves someone added by email the way Settings → Meetings says (spec E, assumption E-1). */
function keepNewGuest(ctx: ActionContext, guest: NewGuest) {
  const { newGuestHandling } = ctx.db.settings.meetings;
  const name = guest.name.trim() || guest.email;
  if (newGuestHandling === "contact" && guest.customerId) {
    ctx.db.put("customerContacts", {
      id: ctx.newId("ccon"),
      customerId: guest.customerId,
      name,
      email: guest.email,
      phone: "",
    });
  } else if (newGuestHandling === "lead") {
    const lead: Customer = {
      id: ctx.newId("cust"),
      type: "homeowner",
      name,
      contactName: name,
      email: guest.email,
      phone: "",
      addresses: [],
      defaultBillingId: null,
      defaultJobSiteId: null,
      terms: "due_on_receipt",
      creditLimit: "0.00",
      taxExempt: false,
      certificate: null,
      salesRepId: ctx.actor.id,
      createdAt: ctx.today,
      lifecycle: "lead",
    };
    ctx.db.put("customers", lead);
  }
}

const blankResponse = {
  role: "required",
  partStat: "needs-action",
  respondedAt: null,
  respondedSequence: null,
  note: "",
  proposal: null,
} satisfies Partial<Attendee>;

/** Whether a guest's email is valid enough to invite. */
const validEmail = (email: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);

/**
 * Schedules a meeting and invites every guest (spec E, ADR 0021): one Outbox row and .ics each,
 * SEQUENCE 0. A guest added by email is kept per Settings → Meetings.
 */
export async function createMeeting(ctx: ActionContext, input: MeetingInput): Promise<Meeting> {
  await ctx.assertCan(["meetings.meeting.create"]);
  if (!input.title.trim()) throw new DemoRuleError("Give the meeting a title.");
  const problem = recurrenceProblem(input.start, input.recurrence);
  if (problem) throw new DemoRuleError(problem);
  for (const g of input.newGuests)
    if (!validEmail(g.email)) throw new DemoRuleError(`"${g.email}" is not a valid email address.`);
  input.newGuests.forEach((g) => keepNewGuest(ctx, g));
  const external = input.newGuests.map((g, i): Attendee => ({
    ...blankResponse,
    kind: "external",
    id: `ext-${ctx.newId("g")}-${i}`,
    name: g.name.trim() || g.email,
    email: g.email,
  }));
  const meeting: Meeting = {
    id: ctx.newId("mtg"),
    title: input.title.trim(),
    start: input.start,
    durationMin: input.durationMin,
    location: input.location,
    attendees: [...input.guests.map((g) => ({ ...blankResponse, ...g })), ...external],
    recurrence: input.recurrence,
    reminderMin: input.reminderMin,
    ownerUserId: ctx.actor.id,
    notes: input.notes,
    timeZone: ctx.db.settings.localization.region.timeZone,
    until: null,
    exceptions: [],
    uid: crypto.randomUUID(),
    sequence: 0,
    rescheduleSequence: 0,
    status: "confirmed",
    kind: "meeting",
    private: input.private,
    hideGuestList: input.hideGuestList || input.private || external.length > 0,
    allowProposals: input.allowProposals,
  };
  ctx.db.put("meetings", meeting);
  sendToGuests(ctx, meeting, {
    recipients: meeting.attendees,
    method: "REQUEST",
    action: "Invitation",
    sequence: 0,
    status: "CONFIRMED",
  });
  scheduleReminder(ctx, meeting);
  ctx.audit({
    category: "data",
    action: "Scheduled meeting",
    target: meeting.title,
    before: null,
    after: `${meeting.start.replace("T", " ")}, ${meeting.attendees.length} guests`,
  });
  return meeting;
}

const SIGNIFICANT = ["start", "durationMin", "recurrence", "until", "status", "location"] as const;

/** Edits a meeting (ADR 0021): a significant change raises SEQUENCE and asks every guest again; a title or notes edit keeps it. */
export async function updateMeeting(
  ctx: ActionContext,
  id: string,
  patch: Partial<Pick<Meeting, "title" | "notes" | "location" | "start" | "durationMin" | "reminderMin">>,
) {
  await ctx.assertCan(["meetings.meeting.edit"]);
  const before = need(ctx, id);
  if (before.status === "cancelled") throw new DemoRuleError("This meeting was cancelled.");
  const merged = { ...before, ...patch };
  const significant = SIGNIFICANT.some((k) => merged[k] !== before[k]);
  const sequence = before.sequence + (significant ? 1 : 0);
  const saved = ctx.db.put("meetings", {
    ...merged,
    sequence,
    rescheduleSequence: significant ? sequence : before.rescheduleSequence,
    attendees: significant
      ? merged.attendees.map((a) => ({ ...a, partStat: "needs-action" as const, respondedAt: null, proposal: null }))
      : merged.attendees,
  });
  sendToGuests(ctx, saved, {
    recipients: saved.attendees,
    method: "REQUEST",
    action: "Updated",
    sequence,
    status: "CONFIRMED",
  });
  ctx.audit({
    category: "data",
    action: "Edited meeting",
    target: saved.title,
    before: before.start.replace("T", " "),
    after: saved.start.replace("T", " "),
  });
  return saved;
}

/** Cancels a meeting and sends the cancellation (ADR 0021: CANCEL, SEQUENCE + 1, all guests). */
export async function cancelMeeting(ctx: ActionContext, id: string) {
  await ctx.assertCan(["meetings.meeting.edit"]);
  const meeting = need(ctx, id);
  const sequence = meeting.sequence + 1;
  const saved = ctx.db.put("meetings", { ...meeting, status: "cancelled", sequence, rescheduleSequence: sequence });
  sendToGuests(ctx, saved, {
    recipients: saved.attendees,
    method: "CANCEL",
    action: "Cancelled",
    sequence,
    status: "CANCELLED",
  });
  ctx.audit({
    category: "data",
    action: "Cancelled meeting",
    target: meeting.title,
    before: "confirmed",
    after: "cancelled",
  });
  return saved;
}

/** Removes one guest: they get a CANCEL, everyone else keeps their answer (ADR 0021). */
export async function removeGuest(ctx: ActionContext, meetingId: string, attendeeId: string) {
  await ctx.assertCan(["meetings.meeting.edit"]);
  const meeting = need(ctx, meetingId);
  const guest = meeting.attendees.find((a) => a.id === attendeeId);
  if (!guest) throw new DemoRuleError("This guest is not on the meeting.");
  const sequence = meeting.sequence + 1;
  const saved = ctx.db.put("meetings", {
    ...meeting,
    sequence,
    attendees: meeting.attendees.filter((a) => a.id !== attendeeId),
  });
  sendToGuests(ctx, saved, { recipients: [guest], listed: [guest], method: "CANCEL", action: "Removed", sequence });
  ctx.audit({
    category: "data",
    action: "Removed meeting guest",
    target: meeting.title,
    before: guest.name,
    after: null,
  });
  return saved;
}

/** Records a reply and tells the organiser; a reply to an older version is kept but changes nothing (ADR 0021). */
function applyReply(
  ctx: ActionContext,
  meeting: Meeting,
  attendee: Attendee,
  reply: ReplyInput,
  sequence: number,
): Meeting {
  const stale = sequence < meeting.rescheduleSequence;
  const log: MeetingResponse = {
    id: ctx.newId("mres"),
    meetingId: meeting.id,
    attendeeId: attendee.id,
    method: reply.proposal ? "counter" : "reply",
    partStat: reply.partStat,
    proposedStart: reply.proposal?.start ?? null,
    note: reply.note,
    sequence,
    at: ctx.now,
    stale,
  };
  ctx.db.put("meetingResponses", log);
  if (stale) return meeting;
  const updated = {
    ...attendee,
    partStat: reply.partStat,
    respondedAt: ctx.now,
    respondedSequence: sequence,
    note: reply.note,
    proposal: reply.proposal ? { ...reply.proposal, status: "pending" as const } : attendee.proposal,
  };
  let saved: Meeting = { ...meeting, attendees: meeting.attendees.map((a) => (a.id === attendee.id ? updated : a)) };
  if (saved.kind === "request" && saved.status === "tentative") {
    if (reply.partStat === "accepted") saved = { ...saved, status: "confirmed", sequence: saved.sequence + 1 };
    if (reply.partStat === "declined") saved = { ...saved, status: "cancelled", sequence: saved.sequence + 1 };
  }
  ctx.db.put("meetings", saved);
  const owner = ctx.db.get("users", meeting.ownerUserId);
  if (owner) {
    const word = reply.proposal ? "proposed a new time" : reply.partStat;
    notify(ctx, {
      key: reply.proposal ? "meeting.proposed" : "meeting.reply",
      source: { type: "meeting", id: meeting.id, href: "/meetings" },
      values: {
        "guest.name": attendee.name,
        "guest.reply": reply.partStat,
        "meeting.title": meeting.title,
        "meeting.when": whenText(reply.proposal?.start ?? meeting.start),
      },
      to: [{ kind: "user", id: owner.id, name: owner.name, email: owner.email }],
      inApp: inAppFor([owner], `${attendee.name} ${word}: ${meeting.title}`),
      version: `${attendee.id}-${ctx.now}`,
      restricted: meeting.private,
    });
  }
  return saved;
}

/** The signed-in person answers an invitation or request (spec E). */
export async function respondToMeeting(ctx: ActionContext, meetingId: string, reply: ReplyInput) {
  await ctx.assertCan(["meetings.meeting.view"]);
  const meeting = need(ctx, meetingId);
  const me = meeting.attendees.find((a) => a.kind === "staff" && a.id === ctx.actor.id);
  if (!me) throw new DemoRuleError("You are not on this meeting.");
  if (reply.proposal && (!meeting.allowProposals || meeting.recurrence !== "none"))
    throw new DemoRuleError("This meeting does not take proposed times.");
  ctx.audit({
    category: "data",
    action: "Answered meeting",
    target: meeting.title,
    before: me.partStat,
    after: reply.partStat,
  });
  return applyReply(ctx, meeting, me, reply, meeting.sequence);
}

/** Stands in for a guest's email reply, from the Outbox (spec E, ADR 0021). */
export async function simulateReply(ctx: ActionContext, outboxId: string, reply: ReplyInput) {
  const message = ctx.db.list("outboxMessages").find((m) => m.id === outboxId);
  if (!message || message.eventKey !== "meeting.invite")
    throw new DemoRuleError("Only a meeting invite can be answered.");
  const meeting = need(ctx, message.sourceId);
  await ctx.assertCan(meeting.ownerUserId === ctx.actor.id ? ["meetings.meeting.view"] : ["settings.outbox.view"]);
  const attendee = meeting.attendees.find((a) => a.id === message.recipient.id);
  if (!attendee) throw new DemoRuleError("This guest is no longer on the meeting.");
  const saved = applyReply(
    ctx,
    meeting,
    attendee,
    reply,
    Number(message.values["meeting.sequence"] ?? meeting.sequence),
  );
  ctx.audit({
    category: "data",
    action: "Simulated guest reply",
    target: meeting.title,
    before: attendee.name,
    after: reply.partStat,
  });
  return saved;
}

/** The organiser accepts or declines a proposed time. Accepting moves the meeting and asks everyone again (ADR 0021). */
export async function decideProposal(ctx: ActionContext, meetingId: string, attendeeId: string, accept: boolean) {
  await ctx.assertCan(["meetings.meeting.edit"]);
  const meeting = need(ctx, meetingId);
  const guest = meeting.attendees.find((a) => a.id === attendeeId);
  if (!guest?.proposal || guest.proposal.status !== "pending")
    throw new DemoRuleError("There is no proposal waiting from this guest.");
  if (!accept) {
    const saved = ctx.db.put("meetings", {
      ...meeting,
      attendees: meeting.attendees.map((a) =>
        a.id === attendeeId ? { ...a, proposal: { ...a.proposal!, status: "declined" as const } } : a,
      ),
    });
    sendToGuests(ctx, saved, {
      recipients: [guest],
      listed: [guest],
      method: "DECLINECOUNTER",
      action: "Proposal declined",
      sequence: saved.sequence,
    });
    return saved;
  }
  const sequence = meeting.sequence + 1;
  const saved = ctx.db.put("meetings", {
    ...meeting,
    start: guest.proposal.start,
    durationMin: guest.proposal.durationMin,
    sequence,
    rescheduleSequence: sequence,
    attendees: meeting.attendees.map((a) => ({
      ...a,
      partStat: "needs-action" as const,
      respondedAt: null,
      proposal: a.id === attendeeId ? { ...a.proposal!, status: "accepted" as const } : null,
    })),
  });
  sendToGuests(ctx, saved, {
    recipients: saved.attendees,
    method: "REQUEST",
    action: "Updated",
    sequence,
    status: "CONFIRMED",
  });
  ctx.audit({
    category: "data",
    action: "Accepted proposed time",
    target: meeting.title,
    before: meeting.start.replace("T", " "),
    after: saved.start.replace("T", " "),
  });
  return saved;
}

/** Any user asks someone to meet (spec E): tentative until they accept. Between staff there is no .ics (ADR 0021). */
export async function requestMeeting(ctx: ActionContext, input: MeetingRequestInput): Promise<Meeting> {
  await ctx.assertCan(["meetings.meeting.create"]);
  if (!input.title.trim()) throw new DemoRuleError("Say what the meeting is about.");
  const other = ctx.db.get("users", input.withUserId);
  if (!other || other.id === ctx.actor.id) throw new DemoRuleError("Choose who to meet with.");
  const guest = (id: string, name: string, email: string, partStat: Attendee["partStat"]): Attendee => ({
    ...blankResponse,
    kind: "staff",
    id,
    name,
    email,
    partStat,
  });
  const meeting: Meeting = {
    id: ctx.newId("mtg"),
    title: input.title.trim(),
    start: input.start,
    durationMin: input.durationMin,
    location: input.location,
    attendees: [
      guest(ctx.actor.id, ctx.actor.name, ctx.actor.email, "accepted"),
      guest(other.id, other.name, other.email, "needs-action"),
    ],
    recurrence: "none",
    reminderMin: ctx.db.settings.meetings.defaultReminderMin,
    ownerUserId: ctx.actor.id,
    notes: input.note,
    timeZone: ctx.db.settings.localization.region.timeZone,
    until: null,
    exceptions: [],
    uid: crypto.randomUUID(),
    sequence: 0,
    rescheduleSequence: 0,
    status: "tentative",
    kind: "request",
    private: input.private,
    hideGuestList: input.private,
    allowProposals: true,
  };
  ctx.db.put("meetings", meeting);
  notify(ctx, {
    key: "meeting.requested",
    source: { type: "meeting", id: meeting.id, href: "/meetings" },
    values: { "actor.name": ctx.actor.name, "meeting.title": meeting.title, "meeting.when": whenText(meeting.start) },
    to: [{ kind: "user", id: other.id, name: other.name, email: other.email }],
    inApp: inAppFor([other], `${ctx.actor.name} asked to meet: ${meeting.title}`),
    restricted: meeting.private,
  });
  ctx.audit({ category: "data", action: "Requested meeting", target: meeting.title, before: null, after: other.name });
  return meeting;
}

/**
 * Moves or resizes a meeting occurrence (spec F) and tells the guests (ADR 0021): one occurrence goes
 * out with RECURRENCE-ID, "this and following" splits into a new UID, and "all" updates the series.
 */
export async function rescheduleMeeting(ctx: ActionContext, move: MeetingMove) {
  await ctx.assertCan(["meetings.meeting.edit"]);
  const meeting = need(ctx, move.meetingId);
  if (move.durationMin < 15) throw new DemoRuleError("A meeting lasts at least 15 minutes.");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(move.start)) throw new DemoRuleError("Enter a date and a start time.");
  const moved = moveOccurrence(
    meeting,
    move.planned,
    { start: move.start, durationMin: move.durationMin },
    move.scope,
    ctx.newId("mtg"),
  );
  const sequence = meeting.sequence + 1;
  const saved = moved.map((m) =>
    m.id === meeting.id
      ? { ...m, sequence, rescheduleSequence: move.scope === "this" ? meeting.rescheduleSequence : sequence }
      : { ...m, uid: crypto.randomUUID(), sequence: 0, rescheduleSequence: 0 },
  );
  for (const m of saved) ctx.db.put("meetings", m);
  const conflicts = attendeeConflicts(ctx.db.list("meetings"), {
    meetingId: meeting.id,
    planned: move.planned,
    start: move.start,
    durationMin: move.durationMin,
    attendees: meeting.attendees,
  });
  ctx.audit({
    category: "data",
    action: "Moved meeting",
    target: meeting.title,
    before: move.planned.replace("T", " "),
    after: `${move.start.replace("T", " ")}, ${move.durationMin} min (${move.scope === "this" ? "this event" : move.scope === "following" ? "this and following" : "all events"})`,
  });
  for (const m of saved) {
    if (move.scope === "this") {
      sendToGuests(ctx, m, {
        recipients: m.attendees,
        method: "REQUEST",
        action: "Updated",
        sequence,
        status: "CONFIRMED",
        recurrenceId: move.planned,
        start: move.start,
        durationMin: move.durationMin,
      });
    } else {
      sendToGuests(ctx, m, {
        recipients: m.attendees,
        method: "REQUEST",
        action: "Updated",
        sequence: m.sequence,
        status: "CONFIRMED",
      });
    }
  }
  const undo: MeetingUndo = {
    previous: meeting,
    createdIds: saved.filter((m) => m.id !== meeting.id).map((m) => m.id),
  };
  return { meetings: saved, conflicts, undo };
}

/** Puts a meeting back as it was before a move, removing a series the move split off. */
export async function undoReschedule(ctx: ActionContext, undo: MeetingUndo): Promise<Meeting> {
  await ctx.assertCan(["meetings.meeting.edit"]);
  for (const id of undo.createdIds) ctx.db.remove("meetings", id);
  const current = ctx.db.get("meetings", undo.previous.id);
  const sequence = (current?.sequence ?? undo.previous.sequence) + 1;
  const restored = ctx.db.put("meetings", { ...undo.previous, sequence, rescheduleSequence: sequence });
  sendToGuests(ctx, restored, {
    recipients: restored.attendees,
    method: "REQUEST",
    action: "Updated",
    sequence,
    status: "CONFIRMED",
  });
  ctx.audit({
    category: "data",
    action: "Undid meeting move",
    target: undo.previous.title,
    before: null,
    after: undo.previous.start.replace("T", " "),
  });
  return restored;
}

/** Copy for the person's own calendar (ADR 0021): METHOD:PUBLISH, no attendees, same UID and SEQUENCE. */
export async function meetingCalendarFile(
  ctx: ActionContext,
  meetingId: string,
): Promise<{ fileName: string; text: string }> {
  await ctx.assertCan(["meetings.meeting.view"]);
  const meeting = need(ctx, meetingId);
  const text = meetingIcs({
    method: "PUBLISH",
    meeting,
    sequence: meeting.sequence,
    stamp: new Date(),
    organizer: organizerOf(ctx, meeting),
    attendees: [],
  });
  return { fileName: `${meeting.title.replace(/[^\w ]+/g, "")}.ics`, text };
}
