import type { CompanyDb, ControlDb } from "@workspace/db";
import { auditLog, meetingAttendees } from "@workspace/db/company";
import {
  dailyEmailProblem,
  dailyInviteProblem,
  zonedToInstantLenient,
  type MeetingEmailCount,
} from "@workspace/shared";
import { and, eq, gte, sql } from "drizzle-orm";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { companyClock, type CompanyClock } from "../sales/sales-common";
import { MEETING_SOURCE } from "./meetings-common";

/** Where a meetings audit entry keeps the emails its action sends, so the daily limits can count them. */
export const SENDS_ENTRY = "sends";

/**
 * When the company's day began, the day the daily limits count (ADR 0051 "Volume limits"). Should
 * midnight not be readable in the company's zone, the last 24 hours count instead, never fewer.
 */
export function dayStartOf(clock: CompanyClock): Date {
  return zonedToInstantLenient(`${clock.day}T00:00`, clock.zone) ?? new Date(clock.now.getTime() - 86_400_000);
}

/** When the company's day began, from its clock in the control database (`dayStartOf`). */
export async function companyDayStart(control: ControlDb, tenant: TenantContext): Promise<Date> {
  return dayStartOf(await companyClock(control, tenant));
}

/**
 * Takes one person's meeting-sends lock until the transaction ends, so two of their actions at once
 * count each other: the second waits until the first has committed its guests and its audit entry.
 * An action takes at most one meeting's row lock, always before this one, so actions never wait on
 * each other in a circle.
 */
async function lockSendsOf(tx: CompanyDb, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`meetings:sends:${userId}`}))`);
}

/**
 * Why one person can't invite these outside addresses today, or null (ADR 0051 "Volume limits"):
 * at most 50 different outside addresses a company day across all their meetings, counted from the
 * outside guests they added, removed ones included, under the person's sends lock.
 */
export async function outsideInviteProblem(
  tx: CompanyDb,
  userId: string,
  outside: readonly string[],
  dayStart: Date,
): Promise<string | null> {
  if (outside.length === 0) return null;
  await lockSendsOf(tx, userId);
  const earlier = await tx
    .selectDistinct({ email: sql<string>`lower(${meetingAttendees.email})` })
    .from(meetingAttendees)
    .where(
      and(
        eq(meetingAttendees.partyType, "external"),
        eq(meetingAttendees.createdBy, userId),
        gte(meetingAttendees.createdAt, dayStart),
      ),
    );
  const already = new Set(earlier.map((row) => row.email));
  return dailyInviteProblem(already.size, outside.filter((email) => !already.has(email)).length);
}

/**
 * Why one person's action can't send its emails today, or null (ADR 0051 "Volume limits"; shared
 * `dailyEmailProblem`). The count is the `sends` of the person's meetings audit entries since the
 * company's day began. Each entry is written in its action's own transaction, under the person's
 * sends lock, before the emails go out after the commit, so the count is exact even for actions
 * sent at once, and nobody can lower it: the audit log refuses updates and deletes.
 */
export async function dailyEmailsProblem(
  tx: CompanyDb,
  userId: string,
  dayStart: Date,
  adding: MeetingEmailCount,
): Promise<string | null> {
  if (adding.total === 0) return null;
  await lockSendsOf(tx, userId);
  const sum = (part: keyof MeetingEmailCount) =>
    sql<string>`coalesce(sum((${auditLog.after} #>> ${`{${SENDS_ENTRY},${part}}`}::text[])::integer), 0)::text`;
  const [today] = await tx
    .select({ outside: sum("outside"), total: sum("total") })
    .from(auditLog)
    .where(and(eq(auditLog.actorUserId, userId), eq(auditLog.targetType, MEETING_SOURCE), gte(auditLog.at, dayStart)));
  return dailyEmailProblem({ outside: Number(today?.outside ?? 0), total: Number(today?.total ?? 0) }, adding);
}
