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
import { authAttempts, rateLimit, tenantBranding, tenants } from "@workspace/db/control";
import type { EmailProvider } from "@workspace/providers";
import {
  effectiveRule,
  featureOn,
  notificationEvent,
  renderTemplate,
  type EmailSettings,
  type NotificationEventKey,
  type NotificationRule,
  type OutboxAttachment,
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
  failureNotice,
  fromHeader,
  oneLine,
  visibleOutboxRow,
  type OutboxReader,
} from "./notification-rules";

/** The queue that sends one Outbox row. */
export const SEND_QUEUE = "outbox.send";
/** The daily queue that deletes sign-in security data older than 30 days (owner decision, 2026-11-13). */
export const CLEANUP_QUEUE = "auth.cleanup";
/** How long `auth_attempts` and `rate_limit` rows are kept (docs/data-model.md, "Retention"). */
const RETENTION_DAYS = 30;

/** How long the provider may take to accept one email before the send counts as failed. */
const SEND_TIMEOUT_MS = 30_000;

/** How long a row may stay `sending` before Retry may take it back (the worker died mid-send). */
const STUCK_SENDING_MS = 10 * 60_000;

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
}

/** What notify wrote. */
export interface NotifyResult {
  queued: string[];
  failed: string[];
  inApp: number;
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
   * (rules 4, 5), writes in-app notes, then queues each sendable row.
   */
  async notify(tenant: TenantContext, actorUserId: string | null, input: NotifyInput): Promise<NotifyResult> {
    const result: NotifyResult = { queued: [], failed: [], inApp: 0 };
    if (!featureOn("settings.notifications")) return result;
    const db = await this.tenancy.db(tenant);
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
          await this.queue(tenant.companyId, row.id, row.scheduledFor);
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

  /** The Outbox as this reader may see it, newest first (spec "Who can see which Outbox row"). */
  async listOutbox(tenant: TenantContext, reader: OutboxReader) {
    const db = await this.tenancy.db(tenant);
    // Only what the Outbox screen shows (spec "Outbox"). Template values, the dedupe key and the
    // provider's id are never returned, so redaction cannot be undone from them (PR #9 review).
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
   * row it takes a queued row whose job is gone (a read-only company, or queueing failed) and a row
   * stuck in `sending` for over 10 minutes (the worker died mid-send). The worker's claim still
   * sends it at most once, and the provider's idempotency key covers a send that did go out.
   */
  async retry(tenant: TenantContext, messageId: string): Promise<void> {
    const db = await this.tenancy.db(tenant);
    const row = await this.rowFor(db, messageId);
    const retryable = or(
      inArray(outboxMessages.status, ["failed", "queued"]),
      and(eq(outboxMessages.status, "sending"), lt(outboxMessages.updatedAt, new Date(Date.now() - STUCK_SENDING_MS))),
    );
    if (row.status !== "failed" && row.status !== "queued" && row.status !== "sending")
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
    // going out at once (PR #9 review; owner's work queue, 2026-11-13).
    const later = row.scheduledFor !== null && row.scheduledFor.getTime() > Date.now() ? row.scheduledFor : null;
    const [requeued] = await db
      .update(outboxMessages)
      .set({ status: later ? "scheduled" : "queued", failureType: null, failureDetail: null })
      .where(and(eq(outboxMessages.id, row.id), retryable))
      .returning({ id: outboxMessages.id });
    // Another Retry moved it first, or it is sending right now (PR #9 review).
    if (!requeued)
      throw new ConflictException({
        code: "not_failed",
        message: "Only a failed or waiting message can be sent again.",
      });
    await this.queue(tenant.companyId, row.id, later);
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

  /** Marks the person's own unread notes read: the given ones, or all of them. */
  async markRead(tenant: TenantContext, userId: string, ids?: readonly string[]): Promise<void> {
    const db = await this.tenancy.db(tenant);
    const mine = and(eq(notifications.userId, userId), isNull(notifications.readAt));
    await db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(ids && ids.length > 0 ? and(mine, inArray(notifications.id, [...ids])) : mine);
  }

  /**
   * Sends one row (ADR 0032). The row is claimed first with one conditional update (queued or
   * scheduled to sending), so a second job, a second Retry or a cancel can never send it twice or
   * after it was cancelled. The claim skips a deleted row and a row whose scheduled time has not
   * come (by the database clock), so no early job sends it before then; its own delayed job does. A read-only company (suspended, cancelled, in maintenance) sends
   * nothing: its rows stay queued, and Retry (or the sweeper, STATUS) sends them once it is
   * writable. A
   * provider failure marks the row failed and tells the actor; Retry sends it again.
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
      .set({ status: "sending" })
      .where(
        and(
          eq(outboxMessages.id, job.data.messageId),
          inArray(outboxMessages.status, ["queued", "scheduled"]),
          isNull(outboxMessages.deletedAt),
          or(isNull(outboxMessages.scheduledFor), lte(outboxMessages.scheduledFor, sql`now()`)),
        ),
      )
      .returning();
    if (!row) return;
    let sentId: string;
    try {
      sentId = (
        await withTimeout(
          this.email.send({
            from: fromHeader(row.fromName, this.emailFrom),
            to: [row.recipientEmail],
            ...(row.replyTo && !addressProblem(row.replyTo) ? { replyTo: row.replyTo } : {}),
            subject: oneLine(row.subject),
            text: row.bodyText,
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
    return {
      companyName,
      fromName: email.senderName || companyName,
      replyTo: email.replyTo ?? "",
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
    const values = { "company.name": sender.companyName, ...input.values, "recipient.name": recipient.name };
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

  /** Queues the send of one row; the worker's claim makes a second job for the same row harmless. */
  private async queue(companyId: string, messageId: string, startAfter: Date | null): Promise<void> {
    await this.jobs.send(SEND_QUEUE, { companyId, messageId }, startAfter ? { startAfter } : {});
  }
}
