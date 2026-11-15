import {
  cancelledMeeting,
  cancelProblem,
  changeRefusal,
  DEFAULT_MEETING_SETTINGS,
  editedMeeting,
  editProblem,
  featureOn,
  guestAuditName,
  guestLimitProblem,
  icsFileName,
  instantToZoned,
  isOnMeeting,
  isOrganiser,
  DEMO_PRODID,
  MEETING_REFUSALS,
  MEETING_REQUEST_DEFAULTS,
  meetingAuditTarget,
  meetingFieldsProblem,
  meetingIcs,
  meetingRequestProblem,
  meetingWhenText,
  newAttendee,
  newGuestProblem,
  nextOccurrence,
  normalizeGuestEmail,
  OUTBOX_RECIPIENT_KIND,
  REMINDER_MINUTES,
  removeGuestProblem,
  replyOutcome,
  replyProblem,
  requestFlags,
  scheduleFlags,
  seesGuestAddresses,
  seesMeeting,
  sendPlan,
  staffGuestOf,
  supportedMeetingZone,
  withoutGuest,
  type Attendee,
  type Company,
  type Customer,
  type Meeting,
  type MeetingPatch,
  type MeetingResponse,
  type MeetingSettings,
  type MyMeetings,
  type ReplyAnswer,
  type ReplyOutcome,
} from "@workspace/shared";
import type { MeetingInput, MeetingRequestInput, MeetingsData, NewGuest, ReplyInput } from "../contract";
import { DemoRuleError } from "./admin-rules";
import type { MeetingMoveMemo } from "./meeting-moves";
import { deliver, invitesOn, organizerOf, seriesSends, syncReminder } from "./meeting-sends";
import {
  colleaguesFor,
  guestOptionsFor,
  partyOf,
  shapedFor,
  visibleMeetings,
  type MeetingSight,
} from "./meeting-sight";
import { notify } from "./notification-actions";
import type { ActionContext } from "./payment-actions";

/** What every demo meetings action is given besides its context (ADR 0051 "Part 3"). */
export interface MeetingScope {
  /** The reader's sight of meetings and their guests (`meetingSightFor`). */
  sight: MeetingSight;
  /** The last move of each meeting, for Undo; every other write forgets it (`saveMeeting`). */
  memo: MeetingMoveMemo;
  company: Company;
}

/** The demo's words for a switched-off feature, which the API answers with a bare 404 (CLAUDE.md rule 13). */
const SWITCHED_OFF = "This feature is switched off.";
/** The API's 404 for a meeting that is gone or outside the reader's sight (`notFound("meeting")`). */
const MEETING_GONE = "This meeting no longer exists.";
/** The API's 404 for a guest who is not on the meeting or not in the reader's reach (`notFound("guest")`). */
export const GUEST_GONE = "This guest no longer exists.";

/** Refuses every meetings action while `meetings.calendar` is off, as every API route does (S4). */
export function calendarOn(): void {
  if (!featureOn("meetings.calendar")) throw new DemoRuleError(SWITCHED_OFF);
}

/** Refuses an action on guests (removals, answers, decisions, Simulate reply) while `meetings.invites` is off (S4). */
export function invitesSwitchedOn(): void {
  if (!invitesOn()) throw new DemoRuleError(SWITCHED_OFF);
}

/** Refuses with a shared rule's own words when it found a problem (the API's `refuseIf`). */
export function refuseIf(problem: string | null): void {
  if (problem) throw new DemoRuleError(problem);
}

/**
 * A meeting the reader may see (the API's `lockVisible`), or a refusal in the API's 404 words that
 * does not say whether it exists. `withCancelled` false also refuses a cancelled meeting, as the
 * calendar file's route does.
 */
export function visible(ctx: ActionContext, sight: MeetingSight, id: string, withCancelled = true): Meeting {
  const meeting = ctx.db.get("meetings", id);
  if (!meeting || (!withCancelled && meeting.status === "cancelled") || !seesMeeting(sight.viewer, meeting))
    throw new DemoRuleError(MEETING_GONE);
  return meeting;
}

/**
 * A meeting the reader may change (the API's `lockChangeable`; ADR 0051 "Who may change a
 * meeting"): seen, and `canChangeMeeting` on it, refused in `changeRefusal`'s words otherwise.
 */
export function changeable(ctx: ActionContext, sight: MeetingSight, id: string): Meeting {
  const meeting = visible(ctx, sight, id);
  refuseIf(changeRefusal(sight.viewer, meeting, sight.seesParty));
  return meeting;
}

/**
 * Saves a meeting after any change but a move, and forgets its last move: on the API that change's
 * audit entry would follow the move's, so Undo answers `meeting_changed` (ADR 0051 "Part 2").
 */
export function saveMeeting(ctx: ActionContext, memo: MeetingMoveMemo, meeting: Meeting): Meeting {
  ctx.db.put("meetings", meeting);
  memo.forget(meeting.id);
  return meeting;
}

/** The time zone meetings are booked in, the company's own, or the API's 409 words when it is not a US one. */
function meetingZone(ctx: ActionContext): string {
  const zone = supportedMeetingZone(ctx.db.settings.localization.region.timeZone);
  if (!zone) throw new DemoRuleError(MEETING_REFUSALS.zoneUnsupported);
  return zone;
}

/** Settings → Meetings with a reminder the form offers, as the API's `loadMeetingSettings` checks it. */
function meetingSettings(ctx: ActionContext): MeetingSettings {
  const stored = ctx.db.settings.meetings;
  return {
    ...stored,
    defaultReminderMin: REMINDER_MINUTES.includes(stored.defaultReminderMin)
      ? stored.defaultReminderMin
      : DEFAULT_MEETING_SETTINGS.defaultReminderMin,
  };
}

const auditTime = (start: string) => start.replace("T", " ");

/**
 * The Meetings page's data (`MeetingsData`; ADR 0051 "Part 3"): every meeting the reader may see,
 * shaped for them; whom they may invite, only with the create key and `meetings.invites` on (GET
 * /meeting-guests); whom they may ask to meet (`colleaguesFor`); the reader's own id; and what a new
 * guest becomes, the demo's setting (Settings → Meetings is demo-only until part 4).
 */
export async function meetingsData(ctx: ActionContext, { sight, company }: MeetingScope): Promise<MeetingsData> {
  calendarOn();
  await ctx.assertCan(["meetings.meeting.view"]);
  const invites = sight.access.permissions.has("meetings.meeting.create") && invitesOn();
  return {
    viewerUserId: sight.viewer.userId,
    meetings: visibleMeetings(ctx.db, sight),
    guests: invites ? guestOptionsFor(ctx.db, sight) : [],
    colleagues: colleaguesFor(ctx.db, company, sight),
    newGuestHandling: ctx.db.settings.meetings.newGuestHandling,
  };
}

/**
 * My meetings (GET /me/meetings; ADR 0051): refused with `meetings.calendar` or `hr.portal` off or
 * without the meetings module (M3), and without the portal key. The meetings the reader organises or
 * is a staff guest on, not cancelled, each with its next occurrence from today, soonest first and
 * shaped for them, and whom they may ask to meet.
 */
export async function myMeetings(ctx: ActionContext, { sight, company }: MeetingScope): Promise<MyMeetings> {
  if (!featureOn("meetings.calendar") || !featureOn("hr.portal") || !sight.modules.includes("meetings"))
    throw new DemoRuleError(SWITCHED_OFF);
  await ctx.assertCan(["hr.portal.view"]);
  const coming = ctx.db
    .list("meetings")
    .filter((meeting) => meeting.status !== "cancelled" && isOnMeeting(meeting, sight.viewer.userId))
    .flatMap((meeting) => {
      const next = nextOccurrence(meeting, ctx.today);
      return next ? [{ meeting: shapedFor(sight, meeting), next }] : [];
    })
    .sort((a, b) => a.next.startsAt.getTime() - b.next.startsAt.getTime());
  return {
    viewerUserId: sight.viewer.userId,
    meetings: coming.map(({ meeting, next }) => ({
      meeting,
      next: { start: next.start, durationMin: next.durationMin, planned: next.planned },
    })),
    colleagues: colleaguesFor(ctx.db, company, sight),
  };
}

/** The kinds of guest a person picks from the company's records (the API's `GUEST` schema). */
const PICKED_KINDS = ["staff", "customer", "customer-contact", "supplier", "supplier-contact"] as const;

/**
 * Who a new meeting's guests are, resolved from the demo's own records as the API's `resolveGuests`
 * does (ADR 0051 "Guests"; critic B4). Only a picked guest's kind and id are read, and only a guest
 * the picker offers this reader (`guestOptionsFor`) is taken; any other is refused in the API's 404
 * words. Names and addresses come from the records, the organiser is left out, and each guest counts
 * once. An address that is an active colleague's becomes that colleague. Returns the guests and the
 * ones added by an address that belongs to nobody in the company.
 */
function resolveGuests(
  ctx: ActionContext,
  sight: MeetingSight,
  picked: readonly Pick<Attendee, "kind" | "id">[],
  byEmail: readonly NewGuest[],
): { guests: Attendee[]; outside: NewGuest[] } {
  if (picked.some((guest) => !(PICKED_KINDS as readonly string[]).includes(guest.kind)))
    throw new DemoRuleError("Choose a guest.");
  const offered = guestOptionsFor(ctx.db, sight);
  const guests: Attendee[] = [];
  for (const kind of PICKED_KINDS) {
    const ids = new Set(
      picked.filter((g) => g.kind === kind && !(kind === "staff" && g.id === sight.viewer.userId)).map((g) => g.id),
    );
    for (const id of ids) {
      const option = offered.find((o) => o.kind === kind && o.id === id);
      if (!option) throw new DemoRuleError(GUEST_GONE);
      // A colleague is offered by name only; their address comes from their record.
      const email = kind === "staff" ? (ctx.db.get("users", id)?.email ?? "") : option.email;
      guests.push(newAttendee({ kind, id, name: option.name, email }));
    }
  }
  const typed = new Map<string, NewGuest>();
  for (const guest of byEmail) {
    const key = normalizeGuestEmail(guest.email);
    if (!typed.has(key)) typed.set(key, guest);
  }
  const members = ctx.db.list("users").filter((user) => user.status === "active");
  const outside: NewGuest[] = [];
  for (const [key, guest] of typed) {
    const member = members.find((m) => normalizeGuestEmail(m.email) === key);
    if (member?.id === sight.viewer.userId) continue;
    if (member) {
      if (!staffGuestOf({ attendees: guests }, member.id))
        guests.push(newAttendee({ kind: "staff", id: member.id, name: member.name, email: member.email }));
      continue;
    }
    if (guests.some((g) => g.email && normalizeGuestEmail(g.email) === key)) continue;
    const email = guest.email.trim();
    guests.push(
      newAttendee({ kind: "external", id: `ext-${ctx.newId("g")}`, name: guest.name.trim() || email, email }),
    );
    outside.push(guest);
  }
  return { guests, outside };
}

/**
 * Keeps a guest added by an outside address the way Settings → Meetings says (demo only, spec
 * assumption E-1; the API never saves one, ADR 0051 "Deferred"), narrowed (ADR 0051 "Part 3", safest
 * option 18): a contact only under a customer the reader can see, a lead only for a reader who may
 * read and create customers. Otherwise the guest is invited and not saved.
 */
function keepNewGuest(ctx: ActionContext, sight: MeetingSight, guest: NewGuest, settings: MeetingSettings): void {
  const name = guest.name.trim() || guest.email.trim();
  const email = guest.email.trim();
  if (settings.newGuestHandling === "contact" && guest.customerId) {
    const customer = ctx.db.get("customers", guest.customerId);
    if (!customer || !sight.readsCustomers || !sight.seesParty(partyOf("customer", customer.id))) return;
    ctx.db.put("customerContacts", { id: ctx.newId("ccon"), customerId: customer.id, name, email, phone: "" });
  } else if (settings.newGuestHandling === "lead") {
    if (!sight.readsCustomers || !sight.access.permissions.has("customers.customer.create")) return;
    const lead: Customer = {
      id: ctx.newId("cust"),
      type: "homeowner",
      name,
      contactName: name,
      email,
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

/**
 * Schedules a meeting (meetings.md "Schedule a meeting"; ADR 0051), as the API's `create`: the
 * company's US zone, the shared field and guest checks, no one else asked while `meetings.invites`
 * is off, guests resolved from the demo's own records (`resolveGuests`), the guest limits, and the
 * server's flags (`scheduleFlags`: a customer or other outside guest hides the list; proposals only
 * for an organiser who may decide them). The organiser joins first, as accepted. Every guest gets an
 * invitation, and the reminder is set. The demo has no daily email caps (B.6 item 4).
 */
export async function createMeeting(ctx: ActionContext, { sight }: MeetingScope, input: MeetingInput) {
  calendarOn();
  await ctx.assertCan(["meetings.meeting.create"]);
  const zone = meetingZone(ctx);
  refuseIf(meetingFieldsProblem(input, { zone, today: ctx.today, recurrence: input.recurrence }));
  for (const guest of input.newGuests) refuseIf(newGuestProblem(guest));
  const othersAsked =
    input.newGuests.length > 0 || input.guests.some((g) => !(g.kind === "staff" && g.id === sight.viewer.userId));
  if (othersAsked && !invitesOn()) throw new DemoRuleError(MEETING_REFUSALS.invitesOff);
  const { guests, outside } = resolveGuests(ctx, sight, input.guests, input.newGuests);
  refuseIf(guestLimitProblem({ guests: guests.length, emailGuests: outside.length }));
  const settings = meetingSettings(ctx);
  const flags = scheduleFlags(
    { private: input.private, hideGuestList: input.hideGuestList },
    guests,
    settings,
    sight.access.permissions.has("meetings.meeting.edit"),
  );
  const { actor } = ctx;
  const meeting: Meeting = {
    id: ctx.newId("mtg"),
    title: input.title.trim(),
    start: input.start,
    durationMin: input.durationMin,
    location: input.location.trim(),
    attendees: [newAttendee({ kind: "staff", id: actor.id, name: actor.name, email: actor.email }, true), ...guests],
    recurrence: input.recurrence,
    reminderMin: input.reminderMin,
    ownerUserId: actor.id,
    notes: input.notes,
    timeZone: zone,
    until: null,
    exceptions: [],
    uid: crypto.randomUUID(),
    sequence: 0,
    rescheduleSequence: 0,
    status: "confirmed",
    kind: "meeting",
    private: input.private,
    ...flags,
  };
  ctx.db.put("meetings", meeting);
  for (const guest of outside) keepNewGuest(ctx, sight, guest, settings);
  deliver(ctx, meeting, sendPlan("schedule", meeting, { invitesOn: invitesOn() }));
  syncReminder(ctx, meeting);
  ctx.audit({
    category: "data",
    action: "Scheduled meeting",
    target: meetingAuditTarget(meeting),
    before: null,
    after: `${auditTime(meeting.start)}, ${guests.length} guests`,
  });
  return shapedFor(sight, meeting);
}

/**
 * Edits a meeting (meetings.md rule 6 and the sends table; ADR 0051), as the API's `update`: only
 * someone who may change it, only an edit `editProblem` allows, and nothing written for no change. A
 * change of start, length or place raises SEQUENCE and asks every guest again; every guest gets an
 * "Updated" invite, with a series' surviving exceptions again, and the reminder follows.
 */
export async function updateMeeting(ctx: ActionContext, { sight, memo }: MeetingScope, id: string, sent: MeetingPatch) {
  calendarOn();
  await ctx.assertCan(["meetings.meeting.edit"]);
  // Compared as stored, so a title or place sent with spaces around it is no change of its own.
  const patch: MeetingPatch = { ...sent, title: sent.title?.trim(), location: sent.location?.trim() };
  const before = changeable(ctx, sight, id);
  const now = new Date();
  refuseIf(editProblem(before, patch, ctx.today, now));
  const edit = editedMeeting(before, patch);
  if (edit.changed.length === 0) return shapedFor(sight, before);
  const saved = saveMeeting(ctx, memo, edit.meeting);
  deliver(ctx, saved, seriesSends(saved, now));
  syncReminder(ctx, saved);
  ctx.audit({
    category: "data",
    action: "Edited meeting",
    target: meetingAuditTarget(before),
    before: auditTime(before.start),
    after: auditTime(saved.start),
  });
  return shapedFor(sight, saved);
}

/** Cancels a meeting, once (meetings.md sends table; ADR 0051): CANCEL to every guest, and its reminder is dropped. */
export async function cancelMeeting(ctx: ActionContext, { sight, memo }: MeetingScope, id: string) {
  calendarOn();
  await ctx.assertCan(["meetings.meeting.edit"]);
  const before = changeable(ctx, sight, id);
  refuseIf(cancelProblem(before));
  const saved = saveMeeting(ctx, memo, cancelledMeeting(before));
  deliver(ctx, saved, sendPlan("cancel", saved, { invitesOn: invitesOn() }));
  syncReminder(ctx, saved);
  ctx.audit({
    category: "data",
    action: "Cancelled meeting",
    target: meetingAuditTarget(before),
    before: before.status,
    after: saved.status,
  });
  return shapedFor(sight, saved);
}

/**
 * Takes one guest off a meeting (meetings.md sends table; ADR 0051), as the API's `removeGuest`:
 * only while `meetings.invites` is on (S4), only someone who may change it, never the organiser and
 * never on a cancelled meeting. SEQUENCE rises by one and only that guest gets a CANCEL.
 */
export async function removeGuest(
  ctx: ActionContext,
  { sight, memo }: MeetingScope,
  meetingId: string,
  attendeeId: string,
) {
  calendarOn();
  invitesSwitchedOn();
  await ctx.assertCan(["meetings.meeting.edit"]);
  const before = changeable(ctx, sight, meetingId);
  const guest = before.attendees.find((a) => a.id === attendeeId);
  if (!guest) throw new DemoRuleError(GUEST_GONE);
  refuseIf(removeGuestProblem(before, guest));
  const saved = saveMeeting(ctx, memo, withoutGuest(before, guest));
  deliver(ctx, saved, sendPlan("remove", saved, { invitesOn: invitesOn(), only: guest }));
  syncReminder(ctx, saved);
  ctx.audit({
    category: "data",
    action: "Removed meeting guest",
    target: meetingAuditTarget(before),
    before: guestAuditName(guest, before),
    after: null,
  });
  return shapedFor(sight, saved);
}

/**
 * Records one guest's checked answer (meetings.md rules 7 and 8; `replyOutcome`): logged whatever
 * it does, saved unless it is stale, the organiser told unless they left, and the reminder re-synced
 * when a request was confirmed or cancelled by it. Every answer forgets the meeting's last move, as
 * its audit entry would on the API.
 */
function recordAnswer(
  ctx: ActionContext,
  memo: MeetingMoveMemo,
  meeting: Meeting,
  guest: Attendee,
  reply: ReplyInput,
  sequence: number,
): ReplyOutcome {
  // `replyProblem` has passed, so the answer is Accept, Maybe or Decline.
  const outcome = replyOutcome(meeting, guest, reply as ReplyAnswer, {
    sequence,
    respondedAt: instantToZoned(new Date(), meeting.timeZone),
  });
  const log: MeetingResponse = {
    id: ctx.newId("mres"),
    meetingId: meeting.id,
    attendeeId: guest.id,
    method: outcome.method,
    partStat: outcome.partStat,
    proposedStart: reply.proposal?.start ?? null,
    note: reply.note,
    sequence,
    at: ctx.now,
    stale: outcome.stale,
  };
  ctx.db.put("meetingResponses", log);
  memo.forget(meeting.id);
  if (!outcome.stale) ctx.db.put("meetings", outcome.meeting);
  tellOrganiser(ctx, meeting, guest, outcome, log.id, reply.proposal?.start ?? null);
  if (outcome.statusChange) syncReminder(ctx, outcome.meeting);
  return outcome;
}

/** Tells the organiser a guest answered (meetings.md "Events": `meeting.reply` or `meeting.proposed`), unless they left. */
function tellOrganiser(
  ctx: ActionContext,
  meeting: Meeting,
  guest: Attendee,
  outcome: ReplyOutcome,
  responseId: string,
  proposedStart: string | null,
): void {
  const organiser = ctx.db.get("users", meeting.ownerUserId);
  if (!outcome.event || organiser?.status !== "active") return;
  const word = outcome.event === "meeting.proposed" ? "proposed a new time" : outcome.partStat;
  notify(ctx, {
    key: outcome.event,
    source: { type: "meeting", id: meeting.id, href: "/meetings" },
    values: {
      "guest.name": guest.name,
      "guest.reply": outcome.partStat,
      "meeting.title": meeting.title,
      "meeting.when": meetingWhenText(proposedStart ?? meeting.start),
    },
    to: [{ kind: "user", id: organiser.id, name: organiser.name, email: organiser.email }],
    inApp: [{ userId: organiser.id, title: `${guest.name} ${word}: ${meeting.title}` }],
    version: responseId,
    restricted: meeting.private,
  });
}

/**
 * The reader answers their own invitation or request (meetings.md "Answer", rules 7 and 8; ADR
 * 0051), as the API's `respond`: only while `meetings.invites` is on (S4), only a staff guest who
 * is not the organiser, never on a cancelled meeting, and only an answer `replyProblem` allows.
 */
export async function respondToMeeting(
  ctx: ActionContext,
  { sight, memo }: MeetingScope,
  id: string,
  reply: ReplyInput,
) {
  calendarOn();
  invitesSwitchedOn();
  await ctx.assertCan(["meetings.meeting.view"]);
  const meeting = visible(ctx, sight, id);
  const guest = staffGuestOf(meeting, sight.viewer.userId);
  if (!guest || isOrganiser(meeting, sight.viewer.userId)) throw new DemoRuleError(MEETING_REFUSALS.notAGuest);
  refuseIf(replyProblem(meeting, reply, ctx.today));
  const outcome = recordAnswer(ctx, memo, meeting, guest, reply, meeting.sequence);
  ctx.audit({
    category: "data",
    action: "Answered meeting",
    target: meetingAuditTarget(meeting),
    before: guest.partStat,
    after: outcome.partStat,
  });
  return shapedFor(sight, outcome.meeting);
}

/**
 * Stands in for a guest's email reply, from the Outbox (demo only, B.6 item 1; meetings.md rule 8):
 * only while `meetings.invites` is on (S4), for the organiser or a holder of `settings.outbox.view`
 * who may see the meeting, from the invite's own guest, with an answer `replyProblem` allows (a
 * proposal only where the meeting takes one), at the SEQUENCE the invite was sent with (rule 7).
 */
export async function simulateReply(
  ctx: ActionContext,
  { sight, memo }: MeetingScope,
  outboxId: string,
  reply: ReplyInput,
) {
  calendarOn();
  invitesSwitchedOn();
  const message = ctx.db.get("outboxMessages", outboxId);
  if (!message || message.eventKey !== "meeting.invite")
    throw new DemoRuleError("Only a meeting invite can be answered.");
  const meeting = ctx.db.get("meetings", message.sourceId);
  if (!meeting || !seesMeeting(sight.viewer, meeting)) throw new DemoRuleError(MEETING_GONE);
  await ctx.assertCan(isOrganiser(meeting, sight.viewer.userId) ? ["meetings.meeting.view"] : ["settings.outbox.view"]);
  const guest = meeting.attendees.find(
    (a) => a.id === message.recipient.id && OUTBOX_RECIPIENT_KIND[a.kind] === message.recipient.kind,
  );
  if (!guest) throw new DemoRuleError("This guest is no longer on the meeting.");
  refuseIf(replyProblem(meeting, reply, ctx.today));
  const sent = Number(message.values["meeting.sequence"]);
  const outcome = recordAnswer(ctx, memo, meeting, guest, reply, Number.isInteger(sent) ? sent : meeting.sequence);
  ctx.audit({
    category: "data",
    action: "Simulated guest reply",
    target: meetingAuditTarget(meeting),
    before: guestAuditName(guest, meeting),
    after: outcome.partStat,
  });
  return shapedFor(sight, outcome.meeting);
}

/**
 * Asks a colleague to meet (meetings.md "Request a meeting"; ADR 0051), as the API's `request`:
 * only with `meetings.requests` and `meetings.invites` on, in the company's US zone, with a request
 * `meetingRequestProblem` allows, and only someone `colleaguesFor` offers the reader (safer than the
 * API, which checks the colleague only: the demo also needs the portal, as Request does on screen).
 * Half an hour, "To be agreed", tentative until they answer, with the server's flags; they are told
 * with `meeting.requested`, not a calendar file.
 */
export async function requestMeeting(ctx: ActionContext, { sight, company }: MeetingScope, input: MeetingRequestInput) {
  calendarOn();
  if (!featureOn("meetings.requests") || !invitesOn()) throw new DemoRuleError(SWITCHED_OFF);
  await ctx.assertCan(["meetings.meeting.create"]);
  const zone = meetingZone(ctx);
  refuseIf(meetingRequestProblem(input, { zone, today: ctx.today }));
  const asked = colleaguesFor(ctx.db, company, sight).some((colleague) => colleague.id === input.withUserId)
    ? ctx.db.get("users", input.withUserId)
    : undefined;
  if (!asked) throw new DemoRuleError(MEETING_REFUSALS.chooseColleague);
  const settings = meetingSettings(ctx);
  const { actor } = ctx;
  const guest = newAttendee({ kind: "staff", id: asked.id, name: asked.name, email: asked.email });
  const meeting: Meeting = {
    id: ctx.newId("mtg"),
    title: input.title.trim(),
    start: input.start,
    durationMin: MEETING_REQUEST_DEFAULTS.durationMin,
    location: MEETING_REQUEST_DEFAULTS.location,
    attendees: [newAttendee({ kind: "staff", id: actor.id, name: actor.name, email: actor.email }, true), guest],
    recurrence: "none",
    reminderMin: settings.defaultReminderMin,
    ownerUserId: actor.id,
    notes: input.note,
    timeZone: zone,
    until: null,
    exceptions: [],
    uid: crypto.randomUUID(),
    sequence: 0,
    rescheduleSequence: 0,
    status: "tentative",
    kind: "request",
    private: input.private,
    ...requestFlags(input.private, settings, sight.access.permissions.has("meetings.meeting.edit")),
  };
  ctx.db.put("meetings", meeting);
  notify(ctx, {
    key: "meeting.requested",
    source: { type: "meeting", id: meeting.id, href: "/meetings" },
    values: {
      "actor.name": actor.name,
      "meeting.title": meeting.title,
      "meeting.when": meetingWhenText(meeting.start),
    },
    to: [{ kind: "user", id: asked.id, name: asked.name, email: asked.email }],
    inApp: [{ userId: asked.id, title: `${actor.name} asked to meet: ${meeting.title}` }],
    version: "request",
    restricted: meeting.private,
  });
  ctx.audit({
    category: "data",
    action: "Requested meeting",
    target: meetingAuditTarget(meeting),
    before: null,
    after: guestAuditName(guest, meeting),
  });
  return shapedFor(sight, meeting);
}

/**
 * "Add to my calendar" (meetings.md sends table; the API's `calendarFile`): a PUBLISH file with no
 * guests, at the current UID and SEQUENCE, for a meeting the reader may see and that is not
 * cancelled. The ORGANIZER address goes only to a reader who may read guests' addresses
 * (`seesGuestAddresses`), so the file never gives an address the meeting hides from them.
 */
export async function meetingCalendarFile(
  ctx: ActionContext,
  { sight }: MeetingScope,
  meetingId: string,
): Promise<{ fileName: string; text: string }> {
  calendarOn();
  await ctx.assertCan(["meetings.meeting.view"]);
  const meeting = visible(ctx, sight, meetingId, false);
  const organizer = organizerOf(ctx.db, meeting);
  const showsAddress = seesGuestAddresses(sight.viewer, meeting, sight.seesParty);
  const text = meetingIcs({
    method: "PUBLISH",
    meeting,
    sequence: meeting.sequence,
    stamp: new Date(),
    organizer: showsAddress ? organizer : { ...organizer, email: "" },
    attendees: [],
    prodId: DEMO_PRODID,
  });
  return { fileName: icsFileName(meeting.title), text };
}
