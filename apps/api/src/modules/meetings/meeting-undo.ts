import type { CompanyDb } from "@workspace/db";
import { auditLog } from "@workspace/db/company";
import { MEETING_LIMITS, isLocalDateTime, type MoveRecord } from "@workspace/shared";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { MEETING_SOURCE } from "./meetings-common";

/** A meeting's newest audit entry, as undo reads it. */
export interface LastMeetingEntry {
  action: string;
  actorUserId: string | null;
  before: unknown;
  after: unknown;
  /** How old the entry is by the database clock, in milliseconds. */
  ageMs: number;
}

/**
 * The newest audit entry of a meeting, read in the caller's transaction after it locked the meeting
 * (ADR 0051 "Part 2", critic B3). Every change to a meeting writes an entry under that lock, so this
 * is the last change made to it. Newest by time, then by id (UUID v7, in insert order). The age is
 * measured by the database clock, the one the entry was stamped with, never the API server's.
 */
export async function lastMeetingEntry(tx: CompanyDb, meetingId: string): Promise<LastMeetingEntry | null> {
  const [row] = await tx
    .select({
      action: auditLog.action,
      actorUserId: auditLog.actorUserId,
      before: auditLog.before,
      after: auditLog.after,
      ageMs: sql<string>`(extract(epoch from (clock_timestamp() - ${auditLog.at})) * 1000)::bigint::text`,
    })
    .from(auditLog)
    .where(and(eq(auditLog.targetType, MEETING_SOURCE), eq(auditLog.targetId, meetingId)))
    .orderBy(desc(auditLog.at), desc(auditLog.id))
    .limit(1);
  return row ? { ...row, ageMs: Number(row.ageMs) } : null;
}

const LOCAL_TIME = z.string().refine(isLocalDateTime);
const SCOPE = z.enum(["this", "following", "all"]);
const COUNT = z.number().int().min(0);

/** One stored exception, exactly as `MeetingException` allows. */
const EXCEPTION = z
  .object({
    planned: LOCAL_TIME,
    start: LOCAL_TIME.optional(),
    durationMin: COUNT.optional(),
    cancelled: z.boolean().optional(),
    sequence: COUNT.optional(),
    location: z.string().max(MEETING_LIMITS.locationMax).optional(),
  })
  .strict();

const RECORD = z
  .object({
    before: z
      .object({
        planned: LOCAL_TIME,
        sequence: COUNT,
        series: z
          .object({
            start: LOCAL_TIME,
            startsAt: z.iso.datetime(),
            durationMin: COUNT,
            until: z.iso.date().nullable(),
            exceptions: z.array(EXCEPTION).max(MEETING_LIMITS.exceptionsMax + 1),
          })
          .strict(),
      })
      .strict(),
    after: z
      .object({
        start: LOCAL_TIME,
        durationMin: COUNT,
        scope: SCOPE,
        sequence: COUNT,
        createdIds: z.array(z.uuid()).max(1),
        // The emails the move sent, which the daily limits count (`SENDS_ENTRY`).
        sends: z.object({ outside: COUNT, total: COUNT }).strict(),
      })
      .strict(),
  })
  .strict();

/**
 * Reads a "Moved meeting" entry back as the move record it was written from (`moveAuditEntry`),
 * through a strict schema, or null for anything else: an entry from before part 2, or one that is
 * malformed. Undo then answers 409 rather than restore a meeting from something it can't trust.
 */
export function parseMoveRecord(before: unknown, after: unknown): MoveRecord | null {
  const parsed = RECORD.safeParse({ before, after });
  if (!parsed.success) return null;
  const { start, durationMin, scope, sequence, createdIds } = parsed.data.after;
  return { before: parsed.data.before, after: { start, durationMin, scope, sequence, createdIds } };
}
