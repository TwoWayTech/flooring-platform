import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import type { CompanyDb, ControlDb, DbHandle } from "@workspace/db";
import { notificationRules, notifications, outboxMessages, settings } from "@workspace/db/company";
import { authAttempts, rateLimit, tenantBranding, tenants, userInvitations } from "@workspace/db/control";
import type { EmailProvider } from "@workspace/providers";
import {
  effectiveRule,
  featureOn,
  isPlainReplyTo,
  isPlainSenderName,
  notificationEvent,
  renderTemplate,
  type EmailSettings,
  type NotificationEventKey,
  type NotificationRule,
  type OutboxAttachment,
  type OutboxReader,
  type OutboxRecipient,
} from "@workspace/shared";
import { and, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import type { Job } from "pg-boss";
import { CONTROL_DB } from "../database/control-db";
import { EMAIL, EMAIL_FROM } from "../email/email.module";
import { JobTenants } from "../jobs/job-tenants";
import { JobsService } from "../jobs/jobs.service";
import { TenantConnectionService } from "../tenancy/tenant-connection.service";
import type { TenantContext } from "../tenancy/tenant-context";
import {
  addressProblem,
  dedupeKey,
  emailAttachments,
  EXPIRES_AT_VALUE,
  failureNotice,
  oneLine,
  senderHeaders,
  visibleOutboxRow,
} from "./notification-rules";

/** The queue that sends one Outbox row. */
export const SEND_QUEUE = "outbox.send";
/** The daily queue that deletes sign-in security data older than 30 days (owner decision, 2026-11-13). */
export const CLEANUP_QUEUE = "auth.cleanup";
/** How long `auth_attempts` and `rate_limit` rows are kept (docs/data-model.md, "Retention"). */
const RETENTION_DAYS = 30;

/** How long the provider may take to accept one email before the send counts as failed. */
const SEND_TIMEOUT_MS = 30_000;

/** The shortest wait before an early job runs again, so clock differences never cause a tight loop. */
const REQUEUE_DELAY_MS = 30_000;

/** How long a row may stay `sending` before Retry may take it back (the worker died mid-send). */
const STUCK_SENDING_MS = 10 * 60_000;

/**
 * Whether a row is past its expiry by the database clock, the clock the claim uses (ADR 0051
 * "Reminder expiry"). An expiry that is not a time counts as past, so a damaged one is never sent.
 */
const PAST_EXPIRY = (() => {
  const expiry = sql`(${outboxMessages.values} ->> ${EXPIRES_AT_VALUE})`;
  return sql`(case when ${expiry} is null then false when ${expiry} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$' then ${expiry}::timestamptz <= now() else true end)`;
})();

/** Rejects when a promise takes longer than `ms`, so a hung provider call cannot hold a row. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** What a send job carries: which company and which row, nothing else. */
interface SendJob {
  companyId: string;
  messageId: string;
}

/** A person to tell in the app. */
export interface InAppNote {
  userId: string;
  title: string;
  href: string;
}

/** One event to raise (spec "Raising an event"). */
export interface NotifyInput {
  event: NotificationEventKey;
  source: { type: string; id: string };
  /** Part of the dedupe key, so a new version of a document may be sent again. */
  version?: string;
  to?: readonly OutboxRecipient[];
  inApp?: readonly InAppNote[];
  values?: Readonly<Record<string, string>>;
  attachments?: readonly OutboxAttachment[];
  restricted?: boolean;
  /** Holds the email until then (spec rule 13, reminders). */
  scheduledFor?: Date;
  /**
   * Drops the email if it has not gone by then, so it is never sent late: a meeting reminder
   * expires when its occurrence starts (ADR 0051 "Reminder expiry"). The worker and Retry both
   * honour it. Kept in the row's values, which readers never get, so no column is added.
   */
  expiresAt?: Date;
}

/** A row `notify` wrote whose send job is left for its caller to queue (`NotificationService.queueSends`). */
export interface UnqueuedSend {
  messageId: string;
  /** When the job may start: the row's scheduled time, or null to send at once. */
  startAfter: Date | null;
}

/** How `notify` writes and queues. */
export interface NotifyOptions {
  /**
   * The caller's transaction of the same company, for rows that must change together with the
   * caller's other writes under its locks, such as a meeting's reminders (ADR 0051): they commit or
   * roll back with it, and no second connection is taken while it holds one. No job is queued in
   * it, as if `deferJobs` were set, so a jobs outage never holds its connection or its locks.
   */
  within?: CompanyDb;
  /**
   * Leaves the send jobs to the caller: the rows are written and come back in `unqueued`, for
   * `queueSends` once they are committed (final review of PR #33).
   */
  deferJobs?: boolean;
}

/** What notify wrote. */
export interface NotifyResult {
  queued: string[];
  failed: string[];
  inApp: number;
  /** The rows among `queued` whose jobs are left to the caller (`NotifyOptions`); empty otherwise. */
  unqueued: UnqueuedSend[];
}

/**
 * The notifications core (spec docs/product-spec/notifications.md; ADR 0020, ADR 0032): raising an
 * event writes one Outbox row per recipient and in-app notes, then the worker sends each row through
 * the EmailProvider (memory locally). A daily job deletes sign-in security data after 30 days.
 */
@Injectable()
export class NotificationService implements OnApplicationBootstrap {
  private readonly logger = new Logger("Notifications");

  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    @Inject(EMAIL) private readonly email: EmailProvider,
    @Inject(EMAIL_FROM) private readonly emailFrom: string,
    private readonly tenancy: TenantConnectionService,
    private readonly jobs: JobsService,
    private readonly jobTenants: JobTenants,
  ) {}

  onApplicationBootstrap(): void {
    // Not awaited: queues are registered once pg-boss has started, which waits for the database,
    // so the API boots even while the database is down (/health reports it).
    void this.registerQueues().catch(() => this.logger.error("Could not register the notification queues."));
  }

  private async registerQueues(): Promise<void> {
    await this.jobs.register<SendJob>(SEND_QUEUE, (job) => this.sendJob(job));
    await this.jobs.register<object>(CLEANUP_QUEUE, () => this.cleanup());
    await this.jobs.schedule(CLEANUP_QUEUE, "17 3 * * *");
  }

  /**
   * Raises an event (spec "Raising an event"): stops when the feature or the event's rule is off,
   * skips the actor, writes one Outbox row per new recipient (dedupe key, spec rule 3) with the
   * subject and body rendered now (snapshots), marks a bad address failed and tells the actor
   * (rules 4, 5), writes in-app notes, then queues each sendable row, or leaves its job to the
   * caller (`NotifyOptions`).
   */
  async notify(
    tenant: TenantContext,
    actorUserId: string | null,
    input: NotifyInput,
    options: NotifyOptions = {},
  ): Promise<NotifyResult> {
    const result: NotifyResult = { queued: [], failed: [], inApp: 0, unqueued: [] };
    if (!featureOn("settings.notifications")) return result;
    const { within } = options;
    const deferJobs = Boolean(within) || options.deferJobs === true;
    const db = within ?? (await this.tenancy.db(tenant));
    const rule = effectiveRule(input.event, await this.rulesFor(db, input.event));
    if (!rule.enabled) return result;
    const sender = await this.senderOf(db, tenant.companyId);
    if (rule.channels.email) {
      for (const recipient of input.to ?? []) {
        if (recipient.kind === "user" && recipient.id === actorUserId) continue;
        const row = await this.writeRow(db, actorUserId, input, rule, sender, recipient);
        if (!row) continue;
        if (row.status === "failed") {
          result.failed.push(row.id);
          if (actorUserId)
            await this.tell(
              db,
              actorUserId,
              input.event,
              failureNotice(recipient.name, row.failureDetail),
              "/settings/outbox",
            );
        } else {
          result.queued.push(row.id);
          if (deferJobs) result.unqueued.push({ messageId: row.id, startAfter: row.scheduledFor });
          else await this.queue(tenant.companyId, row.id, row.scheduledFor);
        }
      }
    }
    if (rule.channels.inApp) {
      for (const note of input.inApp ?? []) {
        if (note.userId === actorUserId) continue;
        await this.tell(db, note.userId, input.event, note.title, note.href);
        result.inApp += 1;
      }
    }
    return result;
  }

  /**
   * Queues the send jobs `notify` left to its caller (`NotifyResult.unqueued`), once their rows are
   * committed, in order. It stops at the first failure, most often background jobs being down
   * (JobsService waits up to 10 seconds for pg-boss to start), so an outage costs one wait, not one
   * per row. The rows not queued stay queued or scheduled with no job, for Retry or the sweeper
   * (STATUS), as a failed queueing leaves a row today. It never throws, and answers whether every
   * job was queued, so the caller can skip queueing anything else for the same request.
   */
  async queueSends(tenant: TenantContext, sends: readonly UnqueuedSend[]): Promise<boolean> {
    for (const send of sends) {
      try {
        await this.queue(tenant.companyId, send.messageId, send.startAfter);
      } catch {
        this.logger.warn("Background jobs are not available, so Outbox messages wait for Retry.");
        return false;
      }
    }
    return true;
  }

  /** The Outbox as this reader may see it, newest first (spec "Who can see which Outbox row"). */
  async listOutbox(tenant: TenantContext, reader: OutboxReader) {
    const db = await this.tenancy.db(tenant);
    // Only what the Outbox screen shows (spec "Outbox"), the sender's name and reply-to included.
    // Template values, the dedupe key and the provider's id are never returned, so redaction cannot be undone from them (PR #9 review).
    const rows = await db
      .select({
        id: outboxMessages.id,
        eventKey: outboxMessages.eventKey,
        sourceType: outboxMessages.sourceType,
        sourceId: outboxMessages.sourceId,
        actorUserId: outboxMessages.actorUserId,
        recipientType: outboxMessages.recipientType,
        recipientId: outboxMessages.recipientId,
        recipientName: outboxMessages.recipientName,
        recipientEmail: outboxMessages.recipientEmail,
        // The sender snapshot the Outbox drawer shows (ADR 0059, bell and Outbox part, D2).
        fromName: outboxMessages.fromName,
        replyTo: outboxMessages.replyTo,
        subject: outboxMessages.subject,
        bodyText: outboxMessages.bodyText,
        attachments: outboxMessages.attachments,
        status: outboxMessages.status,
        failureType: outboxMessages.failureType,
        failureDetail: outboxMessages.failureDetail,
        restricted: outboxMessages.restricted,
        scheduledFor: outboxMessages.scheduledFor,
        sentAt: outboxMessages.sentAt,
        createdAt: outboxMessages.createdAt,
      })
      .from(outboxMessages)
      .where(
        and(
          isNull(outboxMessages.deletedAt),
          // A non-admin's own rows are chosen in SQL, so a busy Outbox never pushes them out of
          // the newest 200 (PR #9 re-review). visibleOutboxRow applies the same rule again.
          reader.admin
            ? undefined
            : or(
                eq(outboxMessages.actorUserId, reader.userId),
                and(eq(outboxMessages.recipientType, "user"), eq(outboxMessages.recipientId, reader.userId)),
                eq(sql`lower(${outboxMessages.recipientEmail})`, reader.email.toLowerCase()),
              ),
        ),
      )
      .orderBy(desc(outboxMessages.createdAt))
      .limit(200);
    return rows.map((row) => visibleOutboxRow(row, reader)).filter((row) => row !== null);
  }

  /**
   * Sends a row again after checking its address once more (spec `retryOutbox`). Besides a failed
   * row it takes a queued row whose job is gone (a read-only company, or queueing failed), a
   * scheduled row whose time has passed with no send (its job ran while the company was read-only),
   * and a row stuck in `sending` for over 10 minutes (the worker died mid-send). The worker's claim still
   * sends it at most once, and the provider's idempotency key covers a send that did go out.
   */
  async retry(tenant: TenantContext, messageId: string): Promise<void> {
    const db = await this.tenancy.db(tenant);
    const row = await this.rowFor(db, messageId);
    const retryable = or(
      inArray(outboxMessages.status, ["failed", "queued"]),
      and(eq(outboxMessages.status, "scheduled"), lte(outboxMessages.scheduledFor, sql`now()`)),
      and(eq(outboxMessages.status, "sending"), lt(outboxMessages.updatedAt, new Date(Date.now() - STUCK_SENDING_MS))),
    );
    if (!["failed", "queued", "scheduled", "sending"].includes(row.status))
      throw new ConflictException({
        code: "not_failed",
        message: "Only a failed or waiting message can be sent again.",
      });
    const problem = addressProblem(row.recipientEmail);
    if (problem) {
      await db
        .update(outboxMessages)
        .set({ failureType: problem.type, failureDetail: problem.detail })
        .where(eq(outboxMessages.id, row.id));
      return;
    }
    // A row scheduled for later goes back to waiting for its time, still cancellable, instead of
    // going out at once (PR #9 review; owner's work queue, 2026-11-13). The database clock decides,
    // the same clock the worker's claim uses (PR #10 review).
    const [requeued] = await db
      .update(outboxMessages)
      .set({
        status: sql`case when ${outboxMessages.scheduledFor} > now() then 'scheduled' else 'queued' end`,
        failureType: null,
        failureDetail: null,
      })
      .where(and(eq(outboxMessages.id, row.id), retryable))
      .returning({ id: outboxMessages.id });
    // Another Retry moved it first, or it is sending right now (PR #9 review).
    if (!requeued)
      throw new ConflictException({
        code: "not_failed",
        message: "Only a failed or waiting message can be sent again.",
      });
    // pg-boss starts a job whose time has passed at once, so the scheduled time is always passed on.
    await this.queue(tenant.companyId, row.id, row.scheduledFor);
  }

  /**
   * Cancels every scheduled row one event raised for one source, such as a meeting's waiting
   * reminders before they are raised again (ADR 0051 "Reminders"). A row already being sent, or
   * sent, is left as it is. `within` is the caller's transaction, as for `NotifyOptions`. Returns
   * how many rows it cancelled.
   */
  async cancelScheduled(
    tenant: TenantContext,
    event: NotificationEventKey,
    source: { type: string; id: string },
    within?: CompanyDb,
  ): Promise<number> {
    const db = within ?? (await this.tenancy.db(tenant));
    const cancelled = await db
      .update(outboxMessages)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(outboxMessages.eventKey, event),
          eq(outboxMessages.sourceType, source.type),
          eq(outboxMessages.sourceId, source.id),
          eq(outboxMessages.status, "scheduled"),
          isNull(outboxMessages.deletedAt),
        ),
      )
      .returning({ id: outboxMessages.id });
    return cancelled.length;
  }

  /** Cancels a scheduled row before it is sent (spec `cancelOutbox`). */
  async cancel(tenant: TenantContext, messageId: string): Promise<void> {
    const db = await this.tenancy.db(tenant);
    const [cancelled] = await db
      .update(outboxMessages)
      .set({ status: "cancelled" })
      .where(
        and(eq(outboxMessages.id, messageId), eq(outboxMessages.status, "scheduled"), isNull(outboxMessages.deletedAt)),
      )
      .returning({ id: outboxMessages.id });
    if (!cancelled)
      throw new ConflictException({ code: "not_scheduled", message: "Only a scheduled message can be cancelled." });
  }

  /** The person's own in-app notes, newest first. */
  async listInApp(tenant: TenantContext, userId: string) {
    const db = await this.tenancy.db(tenant);
    return db
      .select({
        id: notifications.id,
        // Always the reader's own id: the filter below takes no one else's note.
        userId: notifications.userId,
        eventKey: notifications.eventKey,
        title: notifications.title,
        href: notifications.href,
        readAt: notifications.readAt,
        createdAt: notifications.createdAt,
      })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.deletedAt)))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
  }

  /**
   * Marks the person's own unread notes read: the given ones, or all of them when no list is given.
   * An empty list marks none (security review round 1), as the web's contract means it.
   */
  async markRead(tenant: TenantContext, userId: string, ids?: readonly string[]): Promise<void> {
    if (ids && ids.length === 0) return;
    const db = await this.tenancy.db(tenant);
    const mine = and(eq(notifications.userId, userId), isNull(notifications.readAt));
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(ids ? and(mine, inArray(notifications.id, [...ids])) : mine);
  }

  /**
   * Sends one row (ADR 0032). The row is claimed first with one conditional update (queued or
   * scheduled to sending), so a second job, a second Retry or a cancel can never send it twice or
   * after it was cancelled. The claim skips a deleted row and a row whose scheduled time has not
   * come (by the database clock), so no early job sends it before then; its own delayed job does. A
   * read-only company (suspended, cancelled or lapsed) sends nothing, and a company in maintenance
   * or locked gets no job context at all: its rows stay queued or scheduled, and Retry (or the
   * sweeper, STATUS) sends them once it is writable. A
   * provider failure marks the row failed and tells the actor; Retry sends it again. A row past its
   * expiry (`NotifyInput.expiresAt`) is cancelled by the same claim and never sent, so a reminder
   * left waiting while no instance ran workers, or retried late, never arrives after the meeting
   * began (ADR 0051 "Reminder expiry"). The email carries the row's .ics files (`emailAttachments`).
   */
  private async sendJob(job: Job<SendJob>): Promise<void> {
    const tenant = await this.jobTenants.contextFor(job.data.companyId);
    if (!tenant || tenant.readOnly) return;
    const db = await this.tenancy.db(tenant);
    const [exists] = await db
      .select({ id: outboxMessages.id })
      .from(outboxMessages)
      .where(eq(outboxMessages.id, job.data.messageId));
    // Not visible yet: the writing transaction has not committed. Throwing makes pg-boss retry.
    if (!exists) throw new Error("Outbox row not found yet.");
    const [row] = await db
      .update(outboxMessages)
      .set({ status: sql`case when ${PAST_EXPIRY} then 'cancelled' else 'sending' end` })
      .where(
        and(
          eq(outboxMessages.id, job.data.messageId),
          inArray(outboxMessages.status, ["queued", "scheduled"]),
          isNull(outboxMessages.deletedAt),
          or(isNull(outboxMessages.scheduledFor), lte(outboxMessages.scheduledFor, sql`now()`)),
        ),
      )
      .returning();
    if (!row) {
      await this.requeueIfEarly(db, job.data);
      return;
    }
    if (row.status === "cancelled") return;
    const files = emailAttachments(row.attachments);
    let sentId: string;
    try {
      sentId = (
        await withTimeout(
          this.email.send({
            ...senderHeaders(row.fromName, row.replyTo, this.emailFrom),
            to: [row.recipientEmail],
            subject: oneLine(row.subject),
            text: row.bodyText,
            ...(files.length > 0 ? { attachments: files } : {}),
            idempotencyKey: row.dedupeKey,
          }),
          SEND_TIMEOUT_MS,
        )
      ).id;
    } catch {
      // The provider's message can carry the address; it is not stored or logged (rule 14).
      this.logger.warn("An Outbox message could not be sent.");
      const detail = "the email service did not accept the message";
      await db
        .update(outboxMessages)
        .set({ status: "failed", failureType: "provider_error", failureDetail: detail })
        .where(and(eq(outboxMessages.id, row.id), eq(outboxMessages.status, "sending")));
      if (row.actorUserId)
        await this.tell(
          db,
          row.actorUserId,
          row.eventKey,
          failureNotice(row.recipientName, detail),
          "/settings/outbox",
        );
      return;
    }
    // Recorded only after the provider accepted it; if this write fails, the row stays sending and
    // is never sent again by a retry of this job.
    await db
      .update(outboxMessages)
      .set({ status: "sent", sentAt: new Date(), providerMessageId: sentId })
      .where(and(eq(outboxMessages.id, row.id), eq(outboxMessages.status, "sending")));
  }

  /** Deletes sign-in security data older than 30 days (owner retention decision, ADR 0029 part 2). */
  private async cleanup(): Promise<void> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
    await this.control.db.delete(authAttempts).where(lt(authAttempts.createdAt, cutoff));
    await this.control.db.delete(rateLimit).where(lt(rateLimit.lastRequest, cutoff.getTime()));
    // Closed invitations (accepted, revoked or expired) go 30 days after they closed (ADR 0034).
    await this.control.db
      .delete(userInvitations)
      .where(
        or(
          lt(userInvitations.acceptedAt, cutoff),
          lt(userInvitations.revokedAt, cutoff),
          lt(userInvitations.expiresAt, cutoff),
        ),
      );
  }

  private async rulesFor(db: CompanyDb, event: NotificationEventKey): Promise<NotificationRule[]> {
    const rows = await db
      .select()
      .from(notificationRules)
      .where(and(eq(notificationRules.eventKey, event), isNull(notificationRules.deletedAt)));
    return rows.map((row) => ({
      ...row,
      id: row.eventKey,
      updatedAt: row.updatedAt.toISOString(),
      updatedBy: row.createdBy ?? "",
    }));
  }

  /** The sender details and the company name the templates use. */
  private async senderOf(db: CompanyDb, companyId: string) {
    const [branding] = await this.control.db
      .select({ displayName: tenantBranding.displayName })
      .from(tenantBranding)
      .where(eq(tenantBranding.tenantId, companyId));
    const [tenant] = await this.control.db
      .select({ name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, companyId));
    const companyName = branding?.displayName ?? tenant?.name ?? "";
    const [stored] = await db.select({ value: settings.value }).from(settings).where(eq(settings.group, "email"));
    const email = (stored?.value ?? {}) as Partial<EmailSettings>;
    // The row keeps the sender the worker will send (`senderHeaders`), so the Outbox shows what went
    // out and both modes match (DemoStore's `demoSender`; security review round 6).
    const fromName = email.senderName || companyName;
    const replyTo = email.replyTo ?? "";
    return {
      companyName,
      fromName: isPlainSenderName(fromName) ? fromName : "",
      replyTo: isPlainReplyTo(replyTo) ? replyTo : "",
      signature: email.signature ?? "",
    };
  }

  /** Writes one Outbox row, or returns null when this send already exists (dedupe key). */
  private async writeRow(
    db: CompanyDb,
    actorUserId: string | null,
    input: NotifyInput,
    rule: { subject: string; body: string },
    sender: { companyName: string; fromName: string; replyTo: string; signature: string },
    recipient: OutboxRecipient,
  ) {
    const values = {
      "company.name": sender.companyName,
      ...input.values,
      "recipient.name": recipient.name,
      ...(input.expiresAt ? { [EXPIRES_AT_VALUE]: input.expiresAt.toISOString() } : {}),
    };
    const problem = addressProblem(recipient.email);
    const status = problem ? "failed" : input.scheduledFor ? "scheduled" : "queued";
    const [row] = await db
      .insert(outboxMessages)
      .values({
        eventKey: input.event,
        sourceType: input.source.type,
        sourceId: input.source.id,
        actorUserId,
        recipientType: recipient.kind,
        recipientId: recipient.id,
        recipientName: recipient.name,
        recipientEmail: recipient.email,
        fromName: sender.fromName,
        replyTo: sender.replyTo,
        subject: renderTemplate(rule.subject, values).text,
        bodyText: [renderTemplate(rule.body, values).text, sender.signature].filter(Boolean).join("\n\n"),
        values,
        attachments: [...(input.attachments ?? [])],
        status,
        failureType: problem?.type ?? null,
        failureDetail: problem?.detail ?? null,
        scheduledFor: input.scheduledFor ?? null,
        restricted: input.restricted ?? notificationEvent(input.event).restricted ?? false,
        dedupeKey: dedupeKey(input.event, input.source.id, input.version, recipient),
      })
      .onConflictDoNothing({ target: outboxMessages.dedupeKey })
      .returning();
    return row ?? null;
  }

  private async rowFor(db: CompanyDb, messageId: string) {
    const [row] = await db
      .select()
      .from(outboxMessages)
      .where(and(eq(outboxMessages.id, messageId), isNull(outboxMessages.deletedAt)));
    if (!row) throw new NotFoundException();
    return row;
  }

  private async tell(
    db: CompanyDb,
    userId: string,
    event: NotificationEventKey,
    title: string,
    href: string,
  ): Promise<void> {
    await db.insert(notifications).values({ userId, eventKey: event, title, href });
  }

  /**
   * A job that ran before its row's time (clocks differ between the job queue and the company
   * database) queues the send again, so the row is never left waiting with no job (PR #10 review).
   * It waits at least REQUEUE_DELAY_MS, so a lasting clock difference repeats it slowly, never in a
   * tight loop. The claim keeps it to one send whatever the number of jobs.
   */
  private async requeueIfEarly(db: CompanyDb, job: SendJob): Promise<void> {
    const [early] = await db
      .select({ scheduledFor: outboxMessages.scheduledFor })
      .from(outboxMessages)
      .where(
        and(
          eq(outboxMessages.id, job.messageId),
          eq(outboxMessages.status, "scheduled"),
          isNull(outboxMessages.deletedAt),
          sql`${outboxMessages.scheduledFor} > now()`,
        ),
      );
    if (!early?.scheduledFor) return;
    const soonest = Date.now() + REQUEUE_DELAY_MS;
    await this.queue(job.companyId, job.messageId, new Date(Math.max(early.scheduledFor.getTime(), soonest)));
  }

  /** Queues the send of one row; the worker's claim makes a second job for the same row harmless. */
  private async queue(companyId: string, messageId: string, startAfter: Date | null): Promise<void> {
    await this.jobs.send(SEND_QUEUE, { companyId, messageId }, startAfter ? { startAfter } : {});
  }
}
