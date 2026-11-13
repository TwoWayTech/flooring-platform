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
  renderTemplate,
  type EmailSettings,
  type NotificationEventKey,
  type NotificationRule,
  type OutboxAttachment,
  type OutboxRecipient,
} from "@workspace/shared";
import { and, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { Job } from "pg-boss";
import { CONTROL_DB } from "../database/control-db";
import { EMAIL, EMAIL_FROM } from "../email/email.module";
import { JobTenants } from "../jobs/job-tenants";
import { JobsService } from "../jobs/jobs.service";
import { TenantConnectionService } from "../tenancy/tenant-connection.service";
import type { TenantContext } from "../tenancy/tenant-context";
import { addressProblem, dedupeKey, failureNotice, visibleOutboxRow, type OutboxReader } from "./notification-rules";

/** The queue that sends one Outbox row. */
export const SEND_QUEUE = "outbox.send";
/** The daily queue that deletes sign-in security data older than 30 days (owner decision, 2026-11-13). */
export const CLEANUP_QUEUE = "auth.cleanup";
/** How long `auth_attempts` and `rate_limit` rows are kept (docs/data-model.md, "Retention"). */
const RETENTION_DAYS = 30;

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
          await this.queue(tenant.companyId, row.id, row.dedupeKey, row.scheduledFor);
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
    const rows = await db
      .select()
      .from(outboxMessages)
      .where(isNull(outboxMessages.deletedAt))
      .orderBy(desc(outboxMessages.createdAt))
      .limit(200);
    return rows.map((row) => visibleOutboxRow(row, reader)).filter((row) => row !== null);
  }

  /** Sends a failed row again after checking its address once more (spec `retryOutbox`). */
  async retry(tenant: TenantContext, messageId: string): Promise<void> {
    const db = await this.tenancy.db(tenant);
    const row = await this.rowFor(db, messageId);
    if (row.status !== "failed")
      throw new ConflictException({ code: "not_failed", message: "Only a failed message can be sent again." });
    const problem = addressProblem(row.recipientEmail);
    if (problem) {
      await db
        .update(outboxMessages)
        .set({ failureType: problem.type, failureDetail: problem.detail })
        .where(eq(outboxMessages.id, row.id));
      return;
    }
    await db
      .update(outboxMessages)
      .set({ status: "queued", failureType: null, failureDetail: null })
      .where(and(eq(outboxMessages.id, row.id), eq(outboxMessages.status, "failed")));
    await this.queue(tenant.companyId, row.id, row.dedupeKey, null);
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

  /** Sends one queued row. A provider failure marks it failed and tells the actor; Retry sends it again. */
  private async sendJob(job: Job<SendJob>): Promise<void> {
    const tenant = await this.jobTenants.contextFor(job.data.companyId);
    if (!tenant) return;
    const db = await this.tenancy.db(tenant);
    const [row] = await db.select().from(outboxMessages).where(eq(outboxMessages.id, job.data.messageId));
    // Not visible yet: the writing transaction has not committed. Throwing makes pg-boss retry.
    if (!row) throw new Error("Outbox row not found yet.");
    if (row.status !== "queued" && row.status !== "scheduled") return;
    try {
      const sent = await this.email.send({
        from: `${row.fromName} <${this.emailFrom}>`,
        to: [row.recipientEmail],
        ...(row.replyTo ? { replyTo: row.replyTo } : {}),
        subject: row.subject,
        text: row.bodyText,
        idempotencyKey: row.dedupeKey,
      });
      await db
        .update(outboxMessages)
        .set({ status: "sent", sentAt: new Date(), providerMessageId: sent.id })
        .where(and(eq(outboxMessages.id, row.id), inArray(outboxMessages.status, ["queued", "scheduled"])));
    } catch {
      // The provider's message can carry the address; it is not stored or logged (rule 14).
      this.logger.warn("An Outbox message could not be sent.");
      const detail = "the email service did not accept the message";
      await db
        .update(outboxMessages)
        .set({ status: "failed", failureType: "provider_error", failureDetail: detail })
        .where(eq(outboxMessages.id, row.id));
      if (row.actorUserId)
        await this.tell(
          db,
          row.actorUserId,
          row.eventKey,
          failureNotice(row.recipientName, detail),
          "/settings/outbox",
        );
    }
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
        restricted: input.restricted ?? false,
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

  private async queue(companyId: string, messageId: string, key: string, startAfter: Date | null): Promise<void> {
    await this.jobs.send(
      SEND_QUEUE,
      { companyId, messageId },
      { singletonKey: key, ...(startAfter ? { startAfter } : {}) },
    );
  }
}
