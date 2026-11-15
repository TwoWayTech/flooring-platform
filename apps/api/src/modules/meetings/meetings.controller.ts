import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import { Audited, RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { refuse, requireFeature } from "../sales/sales-common";
import { MeetingMoves } from "./meeting-moves.service";
import { MeetingsService } from "./meetings.service";

/**
 * Bounds on what a body may carry before the shared rules read it. They are wider than the rules'
 * own limits (packages/shared `MEETING_LIMITS`), so a long title is refused in the rule's words; they
 * only stop an oversized body.
 */
const TEXT_MAX = 1000;
const NOTES_MAX = 8000;
const LIST_MAX = 120;

/** A local date-time as the screens send it (meetings.md "Meeting": `YYYY-MM-DDTHH:mm`). */
const LOCAL_TIME = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter a date and a start time.");

/** The repeat choices (meetings.md "Meeting", shared `MEETING_RECURRENCES`). */
const RECURRENCE = z.enum(["none", "weekly", "biweekly", "monthly"], "Choose how the meeting repeats.");

/**
 * A guest picked from the company's records, as the screens send it: a whole `Attendee`. Only kind
 * and id are read; the name, address, role, answer, note and proposal are ignored, because the
 * server resolves who the guest is and every guest starts unanswered (ADR 0051, critic B4).
 */
const GUEST = z
  .object({
    kind: z.enum(["staff", "customer", "supplier", "customer-contact", "supplier-contact"], "Choose a guest."),
    id: z.uuid("Choose a guest."),
    name: z.string().max(TEXT_MAX).optional(),
    email: z.string().max(TEXT_MAX).optional(),
    role: z.enum(["required", "optional"]).optional(),
    partStat: z.enum(["needs-action", "accepted", "tentative", "declined"]).optional(),
    respondedAt: z.string().max(40).nullable().optional(),
    respondedSequence: z.number().int().nullable().optional(),
    note: z.string().max(NOTES_MAX).optional(),
    proposal: z
      .object({
        start: z.string().max(40),
        durationMin: z.number(),
        note: z.string().max(NOTES_MAX),
        status: z.string().max(20),
      })
      .partial()
      .strict()
      .nullable()
      .optional(),
  })
  .strict();

/** Someone added by address (`NewGuest`); a customer to save them under is ignored, guests stay guests (ADR 0051). */
const NEW_GUEST = z
  .object({
    email: z.string().max(TEXT_MAX),
    name: z.string().max(TEXT_MAX),
    customerId: z.string().max(100).nullable().optional(),
  })
  .strict();

/** A new meeting (`MeetingInput`); `allowProposals` is accepted and ignored, the server sets it. */
const CREATE = z
  .object({
    title: z.string().max(TEXT_MAX),
    start: LOCAL_TIME,
    durationMin: z.number(),
    location: z.string().max(TEXT_MAX),
    guests: z.array(GUEST).max(LIST_MAX),
    newGuests: z.array(NEW_GUEST).max(LIST_MAX),
    recurrence: RECURRENCE,
    reminderMin: z.number(),
    notes: z.string().max(NOTES_MAX),
    private: z.boolean(),
    hideGuestList: z.boolean(),
    allowProposals: z.boolean().optional(),
  })
  .strict();

/** An edit (meetings.md rule 6: the patch type), each field optional. */
const PATCH = z
  .object({
    title: z.string().max(TEXT_MAX).optional(),
    notes: z.string().max(NOTES_MAX).optional(),
    location: z.string().max(TEXT_MAX).optional(),
    start: LOCAL_TIME.optional(),
    durationMin: z.number().optional(),
    reminderMin: z.number().optional(),
  })
  .strict();

/** A guest's answer (`ReplyInput`); "No reply yet" is refused by the shared rule. */
const REPLY = z
  .object({
    partStat: z.string().max(20),
    note: z.string().max(TEXT_MAX),
    proposal: z
      .object({ start: LOCAL_TIME, durationMin: z.number(), note: z.string().max(TEXT_MAX) })
      .strict()
      .nullable(),
  })
  .strict();

/** A request to meet (`MeetingRequestInput`); the length and place sent are ignored, the server fixes them. */
const REQUEST = z
  .object({
    withUserId: z.uuid("Choose who to meet with."),
    title: z.string().max(TEXT_MAX),
    start: LOCAL_TIME,
    durationMin: z.number().optional(),
    location: z.string().max(TEXT_MAX).optional(),
    note: z.string().max(NOTES_MAX),
    private: z.boolean(),
  })
  .strict();

/**
 * A move (`MeetingMove`, meetings.md "Move or resize"). `meetingId` is the contract's and must name
 * the meeting in the path (critic M); the shared rule checks the rest.
 */
const MOVE = z
  .object({
    meetingId: z.uuid("Choose a meeting.").optional(),
    planned: LOCAL_TIME,
    start: LOCAL_TIME,
    durationMin: z.number(),
    scope: z.enum(["this", "following", "all"], "Choose which events to move."),
  })
  .strict();

/**
 * An undo: only the SEQUENCE the screen saw before its move (`undo.previous.sequence`). The meeting
 * is rebuilt from the server's own record, so a client's copy of it is refused, not read (critic B3).
 */
const UNDO = z.object({ sequence: z.number().int().min(0) }).strict();

/** The organiser's decision on a proposed time. */
const DECISION = z.object({ accept: z.boolean() }).strict();

/**
 * Meetings (meetings.md; ADR 0051), in the `meetings` module of both products. Every route is
 * behind `meetings.calendar`; guests, answers, proposal decisions and the guest picker also need
 * `meetings.invites`; requests need `meetings.requests` and invites, so a request can always be
 * answered; My meetings is the portal's (`hr.portal`). Data scope and the per-meeting rules are
 * applied in the services.
 */
@Controller()
@RequireModule("meetings")
export class MeetingsController {
  constructor(
    private readonly meetings: MeetingsService,
    private readonly moves: MeetingMoves,
  ) {}

  /** GET /meetings: the meetings the person may see, each as they may read it. */
  @Get("meetings")
  @RequirePermission("meetings.meeting.view")
  list(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("meetings.calendar");
    return this.meetings.list(tenant, access);
  }

  /** GET /meeting-guests: whom the person may invite. */
  @Get("meeting-guests")
  @RequirePermission("meetings.meeting.create")
  guests(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("meetings.calendar");
    requireFeature("meetings.invites");
    return this.meetings.guests(tenant, access);
  }

  /** GET /me/meetings: the person's own coming meetings, and whom they may ask to meet. */
  @Get("me/meetings")
  @RequirePermission("hr.portal.view")
  mine(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("meetings.calendar");
    requireFeature("hr.portal");
    return this.meetings.mine(tenant, access);
  }

  /** GET /meetings/:id/calendar.ics: "Add to my calendar", as JSON `{ fileName, text }` (api-contract.md). */
  @Get("meetings/:id/calendar.ics")
  @RequirePermission("meetings.meeting.view")
  calendarFile(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    requireFeature("meetings.calendar");
    return this.meetings.calendarFile(tenant, access, id);
  }

  /** POST /meetings: schedules a meeting with the person as organiser. */
  @Post("meetings")
  @RequirePermission("meetings.meeting.create")
  @Audited()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("meetings.calendar");
    const input = parse(CREATE, body);
    return this.meetings.create(tenant, actorOf(access, session, request), {
      ...input,
      guests: input.guests.map(({ kind, id }) => ({ kind, id })),
      newGuests: input.newGuests.map(({ email, name }) => ({ email, name })),
    });
  }

  /** PATCH /meetings/:id: edits title, notes, place, start, length or reminder. */
  @Patch("meetings/:id")
  @RequirePermission("meetings.meeting.edit")
  @Audited()
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("meetings.calendar");
    return this.meetings.update(tenant, actorOf(access, session, request), id, parse(PATCH, body));
  }

  /** POST /meetings/:id/reschedule: moves or resizes a meeting, or this, the following or all of a series' occurrences. */
  @Post("meetings/:id/reschedule")
  @RequirePermission("meetings.meeting.edit")
  @Audited()
  reschedule(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("meetings.calendar");
    const { meetingId, ...move } = parse(MOVE, body);
    if (meetingId !== undefined && meetingId !== id) throw refuse("The meeting moved must be the one in the address.");
    return this.moves.reschedule(tenant, actorOf(access, session, request), id, move);
  }

  /** POST /meetings/:id/reschedule/undo: undoes the person's own last move of the meeting, rebuilt from its audit entry. */
  @Post("meetings/:id/reschedule/undo")
  @RequirePermission("meetings.meeting.edit")
  @Audited()
  undoReschedule(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("meetings.calendar");
    const { sequence } = parse(UNDO, body);
    return this.moves.undo(tenant, actorOf(access, session, request), id, sequence);
  }

  /** POST /meetings/:id/attendees/:attendeeId/proposal: the organiser accepts or declines a guest's proposed time. */
  @Post("meetings/:id/attendees/:attendeeId/proposal")
  @RequirePermission("meetings.meeting.edit")
  @Audited()
  decideProposal(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("attendeeId", new ParseUUIDPipe()) attendeeId: string,
    @Body() body: unknown,
  ) {
    requireFeature("meetings.calendar");
    requireFeature("meetings.invites");
    const { accept } = parse(DECISION, body);
    return this.moves.decide(tenant, actorOf(access, session, request), id, attendeeId, accept);
  }

  /** POST /meetings/:id/cancel: cancels the meeting for everyone. */
  @Post("meetings/:id/cancel")
  @RequirePermission("meetings.meeting.edit")
  @Audited()
  cancel(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    requireFeature("meetings.calendar");
    return this.meetings.cancel(tenant, actorOf(access, session, request), id);
  }

  /** DELETE /meetings/:id/attendees/:attendeeId: takes one guest off the meeting. */
  @Delete("meetings/:id/attendees/:attendeeId")
  @RequirePermission("meetings.meeting.edit")
  @Audited()
  removeGuest(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("attendeeId", new ParseUUIDPipe()) attendeeId: string,
  ) {
    requireFeature("meetings.calendar");
    requireFeature("meetings.invites");
    return this.meetings.removeGuest(tenant, actorOf(access, session, request), id, attendeeId);
  }

  /** POST /meetings/:id/response: the person answers their own invitation or request. */
  @Post("meetings/:id/response")
  @RequirePermission("meetings.meeting.view")
  @Audited()
  respond(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("meetings.calendar");
    requireFeature("meetings.invites");
    return this.meetings.respond(tenant, actorOf(access, session, request), id, parse(REPLY, body));
  }

  /** POST /meeting-requests: asks a colleague to meet. */
  @Post("meeting-requests")
  @RequirePermission("meetings.meeting.create")
  @Audited()
  request(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("meetings.calendar");
    requireFeature("meetings.requests");
    requireFeature("meetings.invites");
    const input = parse(REQUEST, body);
    return this.meetings.request(tenant, actorOf(access, session, request), {
      withUserId: input.withUserId,
      title: input.title,
      start: input.start,
      note: input.note,
      private: input.private,
    });
  }
}
