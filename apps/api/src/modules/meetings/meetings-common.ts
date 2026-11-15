import { ConflictException, ForbiddenException } from "@nestjs/common";
import type { CompanyDb, ControlDb } from "@workspace/db";
import { meetings, settings, userProfiles } from "@workspace/db/company";
import { user } from "@workspace/db/control";
import {
  DEFAULT_MEETING_SETTINGS,
  meetingAuditTarget,
  REMINDER_MINUTES,
  supportedMeetingZone,
  type Meeting,
  type MeetingSettings,
  type MeetingTimeZone,
  type MeetingViewer,
} from "@workspace/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import type { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { companyClock, notFound, refuse, type CompanyClock } from "../sales/sales-common";

/** A stored meeting row. */
export type MeetingRow = typeof meetings.$inferSelect;

/** What a meeting's Outbox rows and audit entries point at. */
export const MEETING_SOURCE = "meeting";

/** The meeting rules' view of a request's access (packages/shared `MeetingViewer`). */
export function meetingViewer(access: RequestAccess): MeetingViewer {
  return { userId: access.userId, permissions: access.permissions, dataScope: access.dataScope };
}

/**
 * Locks a meeting row for a write in the caller's transaction. Every write to a meeting or its
 * guests takes this lock first, so two changes at once are applied one after the other and each
 * sees the other's SEQUENCE. A missing or deleted meeting answers 404; the caller then checks the
 * viewer may see it, and answers 404 too when they may not (CLAUDE.md rule 3).
 */
export async function lockMeeting(tx: CompanyDb, id: string): Promise<MeetingRow> {
  const [row] = await tx.select().from(meetings).where(eq(meetings.id, id)).for("update");
  if (!row || row.deletedAt) throw notFound("meeting");
  return row;
}

/** Refuses with a shared rule's own words when it found a problem (400 `invalid_request`). */
export function refuseIf(problem: string | null): void {
  if (problem) throw refuse(problem);
}

/** The answer when someone who may see a meeting may not change it (ADR 0051 "Who may change a meeting"). */
export function notTheOrganiser(): ForbiddenException {
  return new ForbiddenException({ code: "forbidden", message: "Only the organiser can change this meeting." });
}

/**
 * The company's clock and the zone its meetings are booked in (ADR 0051 "Owned by the server"). The
 * zone is the company's own, from the control database, never taken from a request. A zone the
 * calendar file has no block for answers 409, because every invite would carry wrong times.
 */
export async function meetingClock(
  control: ControlDb,
  tenant: TenantContext,
): Promise<CompanyClock & { zone: MeetingTimeZone }> {
  const clock = await companyClock(control, tenant);
  const zone = supportedMeetingZone(clock.zone);
  if (!zone) {
    throw new ConflictException({
      code: "time_zone_unsupported",
      message: "Meetings can be booked only in a US time zone, and this company's time zone is not one of them yet.",
    });
  }
  return { ...clock, zone };
}

/**
 * Settings → Meetings as the API uses it (meetings.md "MeetingSettings"; ADR 0051 "Deferred"): the
 * stored group with each value checked, or the safest defaults where one is missing. New guests are
 * never saved as contacts or leads on the API, whatever is stored, so `newGuestHandling` is always
 * "none" here.
 */
export async function loadMeetingSettings(db: CompanyDb): Promise<MeetingSettings> {
  const [row] = await db
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.group, "meetings"), isNull(settings.deletedAt)));
  const stored = (row?.value ?? {}) as Partial<Record<keyof MeetingSettings, unknown>>;
  const reminder = stored.defaultReminderMin;
  return {
    defaultReminderMin:
      typeof reminder === "number" && REMINDER_MINUTES.includes(reminder)
        ? reminder
        : DEFAULT_MEETING_SETTINGS.defaultReminderMin,
    newGuestHandling: "none",
    allowProposals: stored.allowProposals === true,
    hideGuestList:
      typeof stored.hideGuestList === "boolean" ? stored.hideGuestList : DEFAULT_MEETING_SETTINGS.hideGuestList,
  };
}

/** A member of the company as meetings name them: their sign-in name and address, from the control database. */
export interface MeetingPerson {
  id: string;
  name: string;
  email: string;
}

/**
 * The active members of this company among `ids` (or all of them): a profile that is neither
 * removed nor disabled nor still invited, with the name and address of their sign-in. Only they
 * can be staff guests, be asked to meet, or receive a reminder.
 */
export async function activeMembers(
  db: CompanyDb,
  control: ControlDb,
  ids?: readonly string[],
): Promise<MeetingPerson[]> {
  if (ids && ids.length === 0) return [];
  const profiles = await db
    .select({ userId: userProfiles.userId })
    .from(userProfiles)
    .where(
      and(
        eq(userProfiles.status, "active"),
        isNull(userProfiles.deletedAt),
        ids ? inArray(userProfiles.userId, [...ids]) : undefined,
      ),
    );
  if (profiles.length === 0) return [];
  const people = await control
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(
      inArray(
        user.id,
        profiles.map((profile) => profile.userId),
      ),
    );
  return people.sort((a, b) => a.name.localeCompare(b.name));
}

/** The organiser as a calendar file names them, from their sign-in; a missing user gets no ORGANIZER line. */
export async function organiserOf(control: ControlDb, userId: string): Promise<{ name: string; email: string }> {
  const [row] = await control.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, userId));
  return { name: row?.name ?? "Organiser", email: row?.email ?? "" };
}

/**
 * One meetings audit entry in the caller's transaction (CLAUDE.md rule 10; meetings.md "Events and
 * audit entries"). The target is the meeting's title, or "Private meeting" (ADR 0051 "Audit"); the
 * before and after values hold no emails, notes or titles.
 */
export function auditMeeting(
  auditLog: AuditService,
  tenant: TenantContext,
  actor: Actor,
  tx: CompanyDb,
  entry: {
    action: string;
    meeting: Pick<Meeting, "id" | "title" | "private">;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  },
): Promise<void> {
  return auditLog.record(
    tenant,
    actor.audit,
    {
      category: "data",
      action: entry.action,
      targetType: MEETING_SOURCE,
      targetId: entry.meeting.id,
      targetLabel: meetingAuditTarget(entry.meeting),
      before: entry.before,
      after: entry.after,
    },
    tx,
  );
}
