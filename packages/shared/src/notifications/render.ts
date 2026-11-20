import { defaultNumberSettings, formatNumber, type NumberSettings } from "../numbers";
import type { NotificationRule } from "../types/notifications";
import { notificationEvent, type NotificationEvent } from "./events";

const TOKEN = /\{\{\s*([\w.]+)\s*\}\}/g;

/** A template with its tokens filled in, and any token that had no value. */
export interface RenderedTemplate {
  text: string;
  missing: string[];
}

/**
 * Fills a template's tokens (ADR 0020). Tokens are plain names, never expressions, so a template
 * cannot break the way free-form expressions can; a missing value renders empty and is reported
 * for the preview.
 */
export function renderTemplate(template: string, values: Readonly<Record<string, string>>): RenderedTemplate {
  const missing: string[] = [];
  const text = template.replace(TOKEN, (_, name: string) => {
    const value = values[name];
    if (value === undefined) missing.push(name);
    return value ?? "";
  });
  return { text, missing };
}

/** Tokens a template uses that the event does not offer; the editor refuses to save these. */
export function unknownTokens(template: string, event: Pick<NotificationEvent, "variables">): string[] {
  return [...template.matchAll(TOKEN)].map((m) => m[1]!).filter((name) => !(name in event.variables));
}

/** An event's rule as it stands: the company's choices, else the catalogue's defaults. */
export function effectiveRule(
  key: NotificationEvent["key"],
  rules: readonly NotificationRule[],
): Pick<NotificationRule, "enabled" | "channels" | "subject" | "body"> {
  const saved = rules.find((r) => r.id === key);
  if (saved) return saved;
  const event = notificationEvent(key);
  return { enabled: true, channels: event.channels, subject: event.subject, body: event.body };
}

/** The sample values of an event, for a preview when there is no real record to show. */
export function sampleValues(event: Pick<NotificationEvent, "variables">): Record<string, string> {
  return Object.fromEntries(Object.entries(event.variables).map(([key, v]) => [key, v.sample]));
}

/**
 * An amount as messages write it (spec rule 11, "Money in messages"): through the company's number
 * format, whose money style already carries the currency sign ("$1,250.00"), or the US pack's when
 * the company never saved one (CLAUDE.md rule 12: no literal sign). DemoStore and the API both use
 * it, so an email and an in-app title show money the way every screen does (ADR 0059, bell and
 * Outbox part, D6).
 */
export function messageMoney(amount: string, numbers: NumberSettings | undefined): string {
  return formatNumber(amount, "money", numbers ?? defaultNumberSettings());
}
