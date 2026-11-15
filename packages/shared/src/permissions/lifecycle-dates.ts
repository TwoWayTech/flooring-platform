import { companyPhase, LIFECYCLE_DAYS, PHASE_RANK, type LifecycleFacts } from "./company-lifecycle";

const DAY_MS = 86_400_000;

/** The sum of every `LIFECYCLE_DAYS` period plus one day: 165 days today. */
const HORIZON_DAYS = Object.values(LIFECYCLE_DAYS).reduce((sum, days) => sum + days, 0) + 1;

/** The phases a company can still move into: read only, or locked. */
export type LaterPhase = "read_only" | "locked";

/**
 * A moment after which `companyPhase` no longer changes for these facts (docs/specs/platform-admin.md,
 * part 4, "The dates"; ADR 0033's periods). Every boundary in `companyPhase` is an anchor, a row's
 * period end or the status change, plus a sum of distinct `LIFECYCLE_DAYS` values (0, 14, 30, 44
 * or 90 days). That is at most the sum of all of them, so from the latest anchor plus that sum
 * plus one day every ladder sits on its last step. No period length is assumed, so a yearly row
 * ending a year from now is covered. Moments that can't be read are left out of the latest anchor.
 */
export function lifecycleHorizon(facts: LifecycleFacts, now: Date): Date {
  const anchors = [now, facts.statusChangedAt, ...facts.subscriptions.map((row) => row.currentPeriodEnd)]
    .map((moment) => moment.getTime())
    .filter(Number.isFinite);
  return new Date(Math.max(...anchors) + HORIZON_DAYS * DAY_MS);
}

/** Whether the phase at `time` is `target` or stricter. */
function reached(facts: LifecycleFacts, time: number, target: LaterPhase): boolean {
  return PHASE_RANK[companyPhase(facts, new Date(time))] <= PHASE_RANK[target];
}

/**
 * The first moment at which `companyPhase` gives `target` or a stricter phase, or null when the
 * company is already there or never gets there (spec part 4, "The dates").
 *
 * For fixed facts `companyPhase` never steps up as time passes: every ladder only steps down, and
 * the most generous of the rows (a maximum) and then the stricter of that and the status (a
 * minimum) keep that property. So a binary search on whole milliseconds in (now, horizon] finds
 * the exact boundary `companyPhase` itself uses (`now < fullUntil`), in about 35 calls, with no
 * second copy of the ladder.
 */
export function phaseReachedAt(facts: LifecycleFacts, now: Date, target: LaterPhase): Date | null {
  const start = now.getTime();
  if (!Number.isFinite(start) || reached(facts, start, target)) return null;
  let notYet = start;
  let already = lifecycleHorizon(facts, now).getTime();
  if (!reached(facts, already, target)) return null;
  while (already - notYet > 1) {
    const middle = Math.floor((notYet + already) / 2);
    if (reached(facts, middle, target)) already = middle;
    else notYet = middle;
  }
  return new Date(already);
}

/** When a company becomes read only and when it locks, each null when already there or never. */
export interface PhaseDates {
  readOnlyFrom: Date | null;
  lockedFrom: Date | null;
}

/**
 * When a company becomes read only and when it locks, for the Owner's billing notice (spec part 4,
 * "The dates"). Every counted row's ladder ends in `locked`, so `lockedFrom` is set whenever the
 * phase is read only; its null branch is defensive only.
 */
export function phaseDates(facts: LifecycleFacts, now: Date): PhaseDates {
  return {
    readOnlyFrom: phaseReachedAt(facts, now, "read_only"),
    lockedFrom: phaseReachedAt(facts, now, "locked"),
  };
}
