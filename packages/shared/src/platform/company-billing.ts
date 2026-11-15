import {
  companyPhase,
  countedSubscriptions,
  LIFECYCLE_DAYS,
  type LifecycleFacts,
  type LifecycleSubscription,
} from "../permissions/company-lifecycle";
import { phaseDates } from "../permissions/lifecycle-dates";
import type { ProductKey } from "../products";
import type {
  CompanyBilling,
  CompanyBillingSubscription,
  OwnerBillingNotice,
  ReadOnlyReason,
  SubscriptionStanding,
} from "../types/platform";

const DAY_MS = 86_400_000;

/** The 403 `forbidden` message of `GET /billing` for anyone but the Owner; the demo says the same. */
export const BILLING_OWNER_ONLY_MESSAGE = "Only an Owner can see billing.";

/** A moment as the API (a `Date` from the database) or the demo (an ISO string) holds it. */
type Moment = Date | string;

/** Milliseconds since the epoch; NaN for a moment that can't be read. */
function timeOf(moment: Moment): number {
  return moment instanceof Date ? moment.getTime() : Date.parse(moment);
}

/**
 * A subscription row's standing on the Owner's billing page (docs/specs/platform-admin.md, part 4,
 * "CompanyBillingSubscription"): a trial before or after its end, a paid row current or past due
 * before its end and overdue at or after it, a cancelled row cancelled. A status this code doesn't
 * know, or an end that can't be read, is `unknown`.
 */
export function subscriptionStanding(
  row: { status: string; currentPeriodEnd: Moment },
  now: Date,
): SubscriptionStanding {
  const end = timeOf(row.currentPeriodEnd);
  if (!Number.isFinite(end)) return "unknown";
  const ended = end <= now.getTime();
  switch (row.status) {
    case "trial":
      return ended ? "trial_ended" : "trial";
    case "active":
      return ended ? "overdue" : "current";
    case "past_due":
      return ended ? "overdue" : "past_due";
    case "cancelled":
      return "cancelled";
    default:
      return "unknown";
  }
}

/** What the Owner's notice is worked out from, read by the API from control rows only. */
export interface BillingNoticeFacts {
  facts: LifecycleFacts;
  /** `tenant_databases.status` is `read_only`. */
  databaseReadOnly: boolean;
  now: Date;
}

/** A paid plan row: `active` or `past_due`, the rows that get the 14-day grace. */
function isPaidRow(row: LifecycleSubscription): boolean {
  return row.status === "active" || row.status === "past_due";
}

/** The latest period end among the rows, as an ISO moment, or null when none can be read. */
function latestEnd(rows: readonly LifecycleSubscription[]): string | null {
  const ends = rows.map((row) => row.currentPeriodEnd.getTime()).filter(Number.isFinite);
  return ends.length === 0 ? null : new Date(Math.max(...ends)).toISOString();
}

/** A date as an ISO moment, or null. */
function isoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/**
 * Why a read-only company is read only, the first that holds (spec part 4, "The Owner's notice"):
 * suspended, cancelled, a counted row cancelled, every counted row a trial, a counted paid row,
 * a read-only database, else the account.
 */
function readOnlyReason(
  facts: LifecycleFacts,
  counted: readonly LifecycleSubscription[],
  databaseReadOnly: boolean,
): ReadOnlyReason {
  if (facts.status === "suspended") return "suspended";
  if (facts.status === "cancelled") return "cancelled";
  if (counted.some((row) => row.status === "cancelled")) return "cancelled";
  if (counted.length > 0 && counted.every((row) => row.status === "trial")) return "trial_ended";
  if (counted.some(isPaidRow)) return "payment_lapsed";
  return databaseReadOnly ? "database" : "account";
}

/**
 * The notice for a company in full use (spec part 4, "The Owner's notice"), the first that holds:
 * 1. a read-only database, which explains a refusal happening now;
 * 2. a counted paid row has ended and the company becomes read only within the 14-day grace;
 * 3. the company or a counted row is `past_due` (blueprint p23 step 4; nothing writes it today);
 * otherwise none, including when another row keeps the company in full use past the grace.
 */
function fullUseNotice(
  facts: LifecycleFacts,
  counted: readonly LifecycleSubscription[],
  databaseReadOnly: boolean,
  now: Date,
): OwnerBillingNotice | null {
  if (databaseReadOnly) return { kind: "read_only", reason: "database", since: null, lockedFrom: null };
  const { readOnlyFrom } = phaseDates(facts, now);
  const endedPaid = counted.filter((row) => isPaidRow(row) && row.currentPeriodEnd.getTime() <= now.getTime());
  const since = latestEnd(endedPaid);
  const graceEnd = now.getTime() + LIFECYCLE_DAYS.paidGrace * DAY_MS;
  if (endedPaid.length > 0 && readOnlyFrom && readOnlyFrom.getTime() <= graceEnd) {
    return { kind: "payment_overdue", since, readOnlyFrom: readOnlyFrom.toISOString() };
  }
  if (facts.status === "past_due" || counted.some((row) => row.status === "past_due")) {
    return { kind: "payment_overdue", since, readOnlyFrom: isoOrNull(readOnlyFrom) };
  }
  return null;
}

/**
 * The notice the Owner's banner and billing page show, or null (spec part 4, "The Owner's notice").
 * It explains the phase `companyPhase` gives from the same counted rows, with the dates from
 * `phaseDates`: a full company may be overdue or have a read-only database; a read-only company
 * gets its reason and the day it locks; a locked company gets none, because the route is refused
 * before it runs.
 */
export function ownerBillingNotice({ facts, databaseReadOnly, now }: BillingNoticeFacts): OwnerBillingNotice | null {
  const phase = companyPhase(facts, now);
  if (phase === "locked") return null;
  const counted = countedSubscriptions(facts);
  if (phase === "full") return fullUseNotice(facts, counted, databaseReadOnly, now);
  const reason = readOnlyReason(facts, counted, databaseReadOnly);
  return {
    kind: "read_only",
    reason,
    since: readOnlySince(reason, counted),
    lockedFrom: isoOrNull(phaseDates(facts, now).lockedFrom),
  };
}

/**
 * The day a read-only notice says the access ended (spec part 4, "The Owner's notice"): for
 * `payment_lapsed` the latest counted paid row's end, so a trial that ended later is never named as
 * "your plan's period"; for `trial_ended`, where every counted row is a trial, the latest counted
 * row's end; null for any other reason. In a read-only phase every paid row has ended; with none,
 * it is null and the copy says the period has ended without a date.
 */
function readOnlySince(reason: ReadOnlyReason, counted: readonly LifecycleSubscription[]): string | null {
  if (reason === "payment_lapsed") return latestEnd(counted.filter(isPaidRow));
  if (reason === "trial_ended") return latestEnd(counted);
  return null;
}

/**
 * One subscription row as the billing view reads it: the plan and period, with no price, id, plan
 * key or limit override, so none can reach the answer (spec part 4, "Never returned").
 */
export interface BillingRow {
  planName: string;
  product: ProductKey;
  interval: "monthly" | "yearly";
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  status: LifecycleSubscription["status"];
  deleted: boolean;
}

/** What the Owner's billing answer is built from. */
export interface BillingViewInput extends BillingNoticeFacts {
  /** Every row, deleted ones too, oldest first; only live rows are shown. */
  rows: readonly BillingRow[];
  limits: CompanyBilling["limits"];
}

/**
 * The body of `GET /billing` (spec part 4, "The answer, CompanyBilling"): the stored status, the
 * phase TenantDirectory works out, the live rows in order with their standing, the limits and the
 * Owner's notice. The facts carry each row's price only so the life-cycle rule can tell a paid row
 * from a trial; the answer never holds it.
 */
export function companyBillingView({ facts, databaseReadOnly, rows, limits, now }: BillingViewInput): CompanyBilling {
  const subscriptions = rows
    .filter((row) => !row.deleted)
    .map((row): CompanyBillingSubscription => ({
      planName: row.planName,
      product: row.product,
      interval: row.interval,
      currentPeriodStart: row.currentPeriodStart.toISOString(),
      currentPeriodEnd: row.currentPeriodEnd.toISOString(),
      standing: subscriptionStanding(row, now),
    }));
  return {
    status: facts.status,
    phase: companyPhase(facts, now),
    subscriptions,
    limits: { userLimit: limits.userLimit, branchLimit: limits.branchLimit },
    notice: ownerBillingNotice({ facts, databaseReadOnly, now }),
  };
}

/** The line under each plan on the billing page, from its standing and its period end (spec part 4). */
export const SUBSCRIPTION_STANDING_TEXT: Readonly<Record<SubscriptionStanding, (end: string) => string>> = {
  current: (end) => `Current period ends ${end}`,
  past_due: (end) => `Payment overdue; period ends ${end}`,
  overdue: (end) => `Period ended ${end}`,
  trial: (end) => `Trial ends ${end}`,
  trial_ended: (end) => `Trial ended ${end}`,
  cancelled: () => "Cancelled",
  unknown: () => "Status unknown",
};

/** A notice as the banner and the billing page show it. */
export interface BillingNoticeText {
  tone: "warning" | "danger";
  title: string;
  body: string;
  /** Whether the banner links to /settings/billing; false only for a read-only database. */
  linksToBilling: boolean;
}

/** The sentence shared by the suspended and cancelled notices. */
const VIEW_ONLY = "You and your team can view and export, but not make changes.";

/** The clause shared by the lapsed-plan and ended-trial notices. */
const READ_ONLY_NOW = "your company's account is read only.";

/**
 * The words of the Owner's notice (spec part 4, "The Owner's banner", Copy). Dates go through
 * `formatDate`, so the screen shows them in the browser's time zone. The copy never promises that
 * the account stays read only: a read-only company says when it locks, when that is known.
 */
export function billingNoticeText(notice: OwnerBillingNotice, formatDate: (iso: string) => string): BillingNoticeText {
  if (notice.kind === "payment_overdue") {
    const ended = notice.since
      ? `Your plan's period ended on ${formatDate(notice.since)}.`
      : "A payment for your plan is overdue.";
    const readOnly = notice.readOnlyFrom
      ? ` Your company's account becomes read only on ${formatDate(notice.readOnlyFrom)} unless it is renewed.`
      : "";
    return {
      tone: "warning",
      title: "Payment overdue",
      body: `${ended}${readOnly} Contact us to renew.`,
      linksToBilling: true,
    };
  }
  const lock = notice.lockedFrom ? ` It locks on ${formatDate(notice.lockedFrom)}.` : "";
  const since = notice.since ? formatDate(notice.since) : null;
  const danger = (title: string, body: string): BillingNoticeText => ({
    tone: "danger",
    title,
    body,
    linksToBilling: true,
  });
  switch (notice.reason) {
    case "suspended":
      return danger("Account suspended: read only", `${VIEW_ONLY}${lock} Contact us to restore access.`);
    case "cancelled":
      return danger("Account cancelled: read only", `${VIEW_ONLY}${lock} Contact us to reopen it.`);
    case "payment_lapsed": {
      const ended = since ? `Your plan's period ended on ${since}` : "Your plan's period has ended";
      return danger("Plan ended: read only", `${ended}, so ${READ_ONLY_NOW}${lock} Contact us to renew.`);
    }
    case "trial_ended": {
      const ended = since ? `Your trial ended on ${since}` : "Your trial has ended";
      return danger("Trial ended: read only", `${ended}, so ${READ_ONLY_NOW}${lock} Contact us to choose a plan.`);
    }
    case "database":
      return {
        tone: "warning",
        title: "Read only for now",
        body: "Your company's data is read only while we work on its database. Changes can't be saved yet.",
        linksToBilling: false,
      };
    case "account":
    default:
      // A reason this build doesn't know reads as the plain read-only notice (deny by default).
      return danger(
        "Read only",
        "Your company's account is read only right now, so changes can't be saved. Contact us if this is unexpected.",
      );
  }
}
