import {
  effectiveRule,
  featureOn,
  formatNumber,
  notificationEvent,
  renderTemplate,
  type InAppNotification,
  type Invoice,
  type NotificationEventKey,
  type NotificationRule,
  type OutboxAttachment,
  type OutboxFailure,
  type OutboxMessage,
  type OutboxRecipient,
  type Payment,
  type Quote,
  unknownTokens,
} from "@workspace/shared";
import { DemoRuleError } from "./admin-rules";
import type { ActionContext } from "./payment-actions";

/** What an action hands over to raise an event. Recipients are worked out by the caller. */
export interface NotifyInput {
  key: NotificationEventKey;
  source: { type: string; id: string; href: string };
  values: Record<string, string>;
  to: OutboxRecipient[];
  /** People inside the company told in the app. */
  inApp?: { userId: string; title: string }[];
  attachments?: OutboxAttachment[];
  /** Holds the message until this time; used by reminders. */
  scheduledFor?: string;
  /** Tells apart two sends of the same source, such as a meeting's SEQUENCE. */
  version?: string;
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A dollar amount as messages show it, from the company's number settings. */
export function money(ctx: ActionContext, amount: string): string {
  return `$${formatNumber(amount, "money", ctx.db.settings.numbers)}`;
}

function failureOf(email: string): { type: OutboxFailure; detail: string } | null {
  if (!email) return { type: "missing_email", detail: "no email address on file" };
  if (!EMAIL.test(email)) return { type: "invalid_email", detail: "that email address is not valid" };
  return null;
}

/**
 * Raises an event (spec A4, ADR 0020): one Outbox row per recipient with the rendered snapshot, and
 * a stored notification per person told in the app. An event switched off writes nothing. The
 * person who caused an event is never told about it. Nothing is really sent in the demo.
 */
export function notify(ctx: ActionContext, input: NotifyInput): void {
  if (!featureOn("settings.notifications")) return;
  const event = notificationEvent(input.key);
  const rule = effectiveRule(input.key, ctx.db.list("notificationRules"));
  if (!rule.enabled) return;
  const values = { "company.name": ctx.db.settings.branding.displayName, ...input.values };
  if (rule.channels.email) {
    for (const recipient of input.to) {
      if (recipient.kind === "user" && recipient.id === ctx.actor.id) continue;
      const dedupeKey = [input.key, input.source.id, input.version ?? "", recipient.kind, recipient.id].join("|");
      if (ctx.db.list("outboxMessages").some((m) => m.dedupeKey === dedupeKey)) continue;
      const scoped = { ...values, "recipient.name": recipient.name };
      const failure = failureOf(recipient.email);
      const row: OutboxMessage = {
        id: ctx.newId("out"),
        eventKey: input.key,
        sourceType: input.source.type,
        sourceId: input.source.id,
        actorUserId: ctx.actor.id,
        recipient,
        fromName: ctx.db.settings.email.senderName,
        replyTo: ctx.db.settings.email.replyTo,
        subject: renderTemplate(rule.subject, scoped).text,
        values: scoped,
        bodyText: [renderTemplate(rule.body, scoped).text, ctx.db.settings.email.signature]
          .filter(Boolean)
          .join("\n\n"),
        attachments: input.attachments ?? [],
        status: failure ? "failed" : input.scheduledFor ? "scheduled" : "sent",
        failureType: failure?.type ?? null,
        failureDetail: failure?.detail ?? null,
        createdAt: ctx.now,
        scheduledFor: input.scheduledFor ?? null,
        sentAt: failure || input.scheduledFor ? null : ctx.now,
        restricted: event.restricted ?? false,
        dedupeKey,
      };
      ctx.db.put("outboxMessages", row);
      if (failure) reportFailure(ctx, row, input.source.href);
    }
  }
  if (rule.channels.inApp) {
    for (const person of input.inApp ?? []) {
      if (person.userId === ctx.actor.id) continue;
      tell(ctx, { userId: person.userId, eventKey: input.key, title: person.title, href: input.source.href });
    }
  }
}

function tell(ctx: ActionContext, n: Pick<InAppNotification, "userId" | "eventKey" | "title" | "href">) {
  ctx.db.put("inAppNotifications", { id: ctx.newId("ntf"), createdAt: ctx.now, readAt: null, ...n });
}

/** Tells the person who caused a failed send, where the work happens (ADR 0020). */
function reportFailure(ctx: ActionContext, row: OutboxMessage, href: string) {
  if (!row.actorUserId) return;
  tell(ctx, {
    userId: row.actorUserId,
    eventKey: "delivery.failed",
    title: `The email to ${row.recipient.name} could not be delivered: ${row.failureDetail ?? "unknown problem"}`,
    href,
  });
}

/** Everyone holding a permission, for events that go to "people who can approve". */
export async function usersWith(ctx: ActionContext, key: Parameters<ActionContext["can"]>[0]) {
  const roles = ctx.db.list("roles").filter((r) => r.permissions.includes(key));
  return ctx.db
    .list("users")
    .filter((u) => u.status === "active" && u.roleIds.some((id) => roles.some((r) => r.id === id)));
}

/** The in-app recipients for an event sent to a group of users. */
export function inAppFor(users: readonly { id: string }[], title: string) {
  return users.map((u) => ({ userId: u.id, title }));
}

/** The customer as a message recipient. */
export function customerRecipient(ctx: ActionContext, customerId: string): OutboxRecipient {
  const customer = ctx.db.get("customers", customerId);
  return { kind: "customer", id: customerId, name: customer?.name ?? "Customer", email: customer?.email ?? "" };
}

/** Quote sent: the customer gets the quote (spec A4). */
export function notifyQuoteSent(ctx: ActionContext, quote: Quote) {
  const customer = customerRecipient(ctx, quote.customerId);
  notify(ctx, {
    key: "quote.sent",
    source: { type: "quote", id: quote.id, href: `/sales/quotes/${quote.id}` },
    values: {
      "customer.name": customer.name,
      "quote.number": quote.number,
      "quote.total": money(ctx, quote.total),
      "quote.expires": quote.expiresAt ?? "",
    },
    to: [customer],
    attachments: [{ kind: "pdf", fileName: `${quote.number}.pdf`, href: `/sales/quotes/${quote.id}` }],
    version: quote.sentAt ?? "",
  });
}

/** Invoice sent: the customer gets the invoice (spec A4). */
export function notifyInvoiceSent(ctx: ActionContext, invoice: Invoice) {
  const customer = customerRecipient(ctx, invoice.customerId);
  notify(ctx, {
    key: "invoice.sent",
    source: { type: "invoice", id: invoice.id, href: `/sales/invoices/${invoice.id}` },
    values: {
      "customer.name": customer.name,
      "invoice.number": invoice.number,
      "invoice.total": money(ctx, invoice.total),
      "invoice.due": invoice.dueAt ?? "",
    },
    to: [customer],
    attachments: [{ kind: "pdf", fileName: `${invoice.number}.pdf`, href: `/sales/invoices/${invoice.id}` }],
  });
}

/** Tells the people who can approve that a payment waits for them (spec A4). */
export async function notifyPaymentToVerify(ctx: ActionContext, number: string, amount: string, href: string) {
  const approvers = await usersWith(ctx, "sales.payment.approve");
  const title = `Payment of ${money(ctx, amount)} on ${number} needs checking`;
  notify(ctx, {
    key: "payment.to_verify",
    source: { type: "payment", id: `${number}-${amount}`, href },
    values: { "actor.name": ctx.actor.name, "document.number": number, "payment.amount": money(ctx, amount) },
    to: approvers.map((u) => ({ kind: "user" as const, id: u.id, name: u.name, email: u.email })),
    inApp: inAppFor(approvers, title),
  });
}

/** Payment receipt: the customer's copy once a payment is confirmed (spec A4). */
export function notifyPaymentReceipt(ctx: ActionContext, payment: Payment, invoice: Invoice, balance: string) {
  const customer = customerRecipient(ctx, invoice.customerId);
  notify(ctx, {
    key: "payment.receipt",
    source: { type: "payment", id: payment.id, href: `/sales/invoices/${invoice.id}` },
    values: {
      "customer.name": customer.name,
      "invoice.number": invoice.number,
      "invoice.balance": money(ctx, balance),
      "payment.amount": money(ctx, payment.amount),
    },
    to: [customer],
    attachments: [{ kind: "pdf", fileName: `Receipt ${payment.number}.pdf`, href: `/sales/invoices/${invoice.id}` }],
  });
}

/** Saves a company's choices for one event; refuses unknown tokens (ADR 0020). */
export async function saveNotificationRule(
  ctx: ActionContext,
  rule: Omit<NotificationRule, "updatedAt" | "updatedBy">,
) {
  await ctx.assertCan(["settings.notifications.manage"]);
  const event = notificationEvent(rule.id);
  const bad = [...unknownTokens(rule.subject, event), ...unknownTokens(rule.body, event)];
  if (bad.length) throw new DemoRuleError(`This event has no {{ ${bad[0]} }}. Use one of the variables listed.`);
  const saved: NotificationRule = { ...rule, updatedAt: ctx.now, updatedBy: ctx.actor.name };
  ctx.db.put("notificationRules", saved);
  ctx.audit({
    category: "settings",
    action: "Changed notification",
    target: event.label,
    before: null,
    after: rule.enabled ? (rule.channels.email ? "email" : "") + (rule.channels.inApp ? " in-app" : "") : "off",
  });
  return saved;
}

/** Puts one event back to the catalogue's defaults. */
export async function resetNotificationRule(ctx: ActionContext, key: NotificationEventKey) {
  await ctx.assertCan(["settings.notifications.manage"]);
  ctx.db.remove("notificationRules", key);
  ctx.audit({
    category: "settings",
    action: "Reset notification",
    target: notificationEvent(key).label,
    before: null,
    after: "default",
  });
}

/** The Outbox as a person may see it (ADR 0020): their own rows, or all with settings.outbox.view; restricted rows are redacted. */
export async function listOutbox(ctx: ActionContext, all: boolean): Promise<OutboxMessage[]> {
  const admin = all && (await ctx.can("settings.outbox.view"));
  const hrView = await ctx.can("hr.employee.view");
  const mine = (m: OutboxMessage) =>
    m.actorUserId === ctx.actor.id ||
    (m.recipient.kind === "user" && m.recipient.id === ctx.actor.id) ||
    m.recipient.email === ctx.actor.email;
  return ctx.db
    .list("outboxMessages")
    .filter((m) => admin || mine(m))
    .map((m) =>
      m.restricted && !mine(m) && !hrView
        ? { ...m, subject: "Restricted message", bodyText: "Only the people involved can read this.", attachments: [] }
        : m,
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function outboxRow(ctx: ActionContext, id: string): OutboxMessage {
  const row = ctx.db.get("outboxMessages", id);
  if (!row) throw new DemoRuleError("This message no longer exists.");
  return row;
}

/** Sends a failed row again: back through queued to sent, with a fresh failure check. */
export async function retryOutbox(ctx: ActionContext, id: string) {
  const row = outboxRow(ctx, id);
  if (row.status !== "failed") throw new DemoRuleError("Only a failed message can be sent again.");
  const failure = failureOf(row.recipient.email);
  return ctx.db.put("outboxMessages", {
    ...row,
    status: failure ? "failed" : "sent",
    failureType: failure?.type ?? null,
    failureDetail: failure?.detail ?? null,
    sentAt: failure ? null : ctx.now,
  });
}

/** Cancels a scheduled row. */
export async function cancelOutbox(ctx: ActionContext, id: string) {
  const row = outboxRow(ctx, id);
  if (row.status !== "scheduled") throw new DemoRuleError("Only a scheduled message can be cancelled.");
  return ctx.db.put("outboxMessages", { ...row, status: "cancelled" });
}

/** Presenter tool: marks a sent row as bounced, to show where a delivery failure lands. */
export async function simulateBounce(ctx: ActionContext, id: string) {
  await ctx.assertCan(["settings.outbox.view"]);
  const row = outboxRow(ctx, id);
  if (row.status !== "sent") throw new DemoRuleError("Only a sent message can bounce.");
  const bounced = ctx.db.put("outboxMessages", {
    ...row,
    status: "failed",
    failureType: "bounced",
    failureDetail: "the mailbox refused the message",
    sentAt: null,
  });
  reportFailure(ctx, bounced, "/outbox");
  return bounced;
}

/** Turns scheduled rows whose time has come into sent ones; the demo has no background worker. */
export function releaseScheduled(ctx: ActionContext): void {
  for (const row of ctx.db.list("outboxMessages")) {
    if (row.status === "scheduled" && row.scheduledFor && row.scheduledFor <= ctx.now) {
      ctx.db.put("outboxMessages", { ...row, status: "sent", sentAt: row.scheduledFor });
    }
  }
}

/** The signed-in person's stored notifications, newest first. */
export function myNotifications(ctx: ActionContext): InAppNotification[] {
  return ctx.db
    .list("inAppNotifications")
    .filter((n) => n.userId === ctx.actor.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Marks notifications read, only the person's own. */
export function markNotificationsRead(ctx: ActionContext, ids: readonly string[]) {
  for (const n of myNotifications(ctx)) {
    if (ids.includes(n.id) && !n.readAt) ctx.db.put("inAppNotifications", { ...n, readAt: ctx.now });
  }
}
