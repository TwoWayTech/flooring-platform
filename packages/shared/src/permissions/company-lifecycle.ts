import Decimal from "decimal.js";

/**
 * How much of its data a company may use now:
 * - `full`: read and write;
 * - `read_only`: read and export, no changes;
 * - `locked`: sign in only. Every company route is refused until a platform admin acts or the
 *   company pays. Nothing is ever deleted automatically (owner decision, 2026-11-13).
 */
export type CompanyPhase = "full" | "read_only" | "locked";

/** A company status as the control database stores it (blueprint p29, p40). */
export type LifecycleStatus = "trial" | "active" | "past_due" | "suspended" | "cancelled";

/** One subscription row, deleted ones included, as the lifecycle rule reads it. */
export interface LifecycleSubscription {
  status: "trial" | "active" | "past_due" | "cancelled";
  currentPeriodEnd: Date;
  /** The price as a decimal string; a cancelled row with a price above zero was a paid plan. */
  price: string;
  deleted: boolean;
}

/** What the lifecycle rule needs to know about a company. */
export interface LifecycleFacts {
  status: LifecycleStatus;
  /** When the status last changed; a database trigger keeps it (control migration 0003). */
  statusChangedAt: Date;
  subscriptions: readonly LifecycleSubscription[];
}

/** The owner's periods (2026-11-13) and the blueprint's 90 days for a cancelled company (p29). */
export const LIFECYCLE_DAYS = {
  /** A lapsed paid plan keeps full access this long after its period ends. */
  paidGrace: 14,
  /** Then it is read-only this long. */
  paidReadOnly: 30,
  /** A trial that ended, or was suspended or cancelled, before paying is read-only this long, to export. */
  unpaidReadOnly: 30,
  /** A company that paid and then cancelled is read-only this long (blueprint p29). */
  cancelledPaidReadOnly: 90,
} as const;

const DAY_MS = 86_400_000;
/**
 * How much access each phase gives, higher is more. `companyPhase` keeps the most generous row's
 * phase and then the stricter of that and the status's; `lifecycle-dates.ts` and the Owner's
 * billing notice compare phases with the same ranks (docs/specs/platform-admin.md, part 4).
 */
export const PHASE_RANK: Readonly<Record<CompanyPhase, number>> = { locked: 0, read_only: 1, full: 2 };

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Full before `fullUntil`, read-only before `readOnlyUntil`, locked after. */
function ladder(now: Date, fullUntil: Date, readOnlyUntil: Date): CompanyPhase {
  if (now < fullUntil) return "full";
  return now < readOnlyUntil ? "read_only" : "locked";
}

/** Whether a subscription row was a paid plan, not a trial. */
function wasPaid(subscription: LifecycleSubscription): boolean {
  if (subscription.status === "active" || subscription.status === "past_due") return true;
  return subscription.status === "cancelled" && new Decimal(subscription.price).greaterThan(0);
}

/**
 * Whether the company ever paid (blueprint p29, p40): any subscription row, deleted ones included,
 * that is `active` or `past_due`, or `cancelled` with a price above zero. `companyPhase` uses it for
 * the suspended and cancelled ladders, and the console's reinstate uses it to choose `active` over
 * `trial` (docs/specs/platform-admin.md, part 2, `statusAfter` check 5).
 */
export function companyEverPaid(subscriptions: readonly LifecycleSubscription[]): boolean {
  return subscriptions.some(wasPaid);
}

/** One live subscription's phase, from the end of its period. */
function subscriptionPhase(subscription: LifecycleSubscription, now: Date): CompanyPhase {
  const end = subscription.currentPeriodEnd;
  switch (subscription.status) {
    case "active":
    case "past_due":
      return ladder(
        now,
        addDays(end, LIFECYCLE_DAYS.paidGrace),
        addDays(end, LIFECYCLE_DAYS.paidGrace + LIFECYCLE_DAYS.paidReadOnly),
      );
    case "trial":
      return ladder(now, end, addDays(end, LIFECYCLE_DAYS.unpaidReadOnly));
    case "cancelled": {
      const readOnly = wasPaid(subscription) ? LIFECYCLE_DAYS.cancelledPaidReadOnly : LIFECYCLE_DAYS.unpaidReadOnly;
      return ladder(now, end, addDays(end, readOnly));
    }
    default:
      // A status this code does not know gives no access (PR #10 review).
      return "locked";
  }
}

/** The phase the company's status gives, counted from when the status last changed. */
function statusPhase(facts: LifecycleFacts, everPaid: boolean, now: Date): CompanyPhase {
  const since = facts.statusChangedAt;
  switch (facts.status) {
    case "trial":
    case "active":
    case "past_due":
      return "full";
    case "suspended":
      // A suspended company that paid stays readable until a platform admin acts (blueprint p40).
      return everPaid ? "read_only" : ladder(now, since, addDays(since, LIFECYCLE_DAYS.unpaidReadOnly));
    case "cancelled":
      return ladder(
        now,
        since,
        addDays(since, everPaid ? LIFECYCLE_DAYS.cancelledPaidReadOnly : LIFECYCLE_DAYS.unpaidReadOnly),
      );
    default:
      return "locked";
  }
}

/**
 * The subscription rows whose ladders count: the live rows, or every row when none is live, so
 * deleting a lapsed row never restores access (PR #10 review). `companyPhase` counts these, and the
 * Owner's billing notice explains its phase from the same rows (docs/specs/platform-admin.md,
 * "The Owner's notice").
 */
export function countedSubscriptions(facts: LifecycleFacts): readonly LifecycleSubscription[] {
  const live = facts.subscriptions.filter((subscription) => !subscription.deleted);
  return live.length > 0 ? live : facts.subscriptions;
}

/**
 * Where a company stands in its life cycle (owner decisions, 2026-11-13; blueprint p29, p40):
 * - A paid plan (`active`, `past_due`) keeps full access for 14 days after its period ends, is then
 *   read-only for 30 days, then locked.
 * - A trial that ends, or is suspended or cancelled, before the company ever paid is read-only for
 *   30 days so the company can export its data, then locked.
 * - A company that paid and then cancelled is read-only for 90 days, then locked (p29).
 * - A suspended company that paid stays read-only until a platform admin acts (p40).
 * - A fresh trial, with no subscription rows, stays full: plan prices are still open.
 *
 * Each live subscription gives a phase and the most generous one counts, since any current plan
 * gives access; the status then can only make it stricter. When every row is deleted, the latest
 * deleted rows still run their own ladder, so deleting a lapsed row never restores access (PR #10
 * review); only a company with no rows at all counts as a fresh trial. Deleted rows also prove the
 * company paid once.
 */
export function companyPhase(facts: LifecycleFacts, now: Date = new Date()): CompanyPhase {
  const everPaid = companyEverPaid(facts.subscriptions);
  const counted = countedSubscriptions(facts);
  const fromSubscriptions =
    counted.length === 0
      ? "full"
      : counted
          .map((subscription) => subscriptionPhase(subscription, now))
          .reduce((best, phase) => (PHASE_RANK[phase] > PHASE_RANK[best] ? phase : best));
  const fromStatus = statusPhase(facts, everPaid, now);
  return PHASE_RANK[fromStatus] < PHASE_RANK[fromSubscriptions] ? fromStatus : fromSubscriptions;
}
