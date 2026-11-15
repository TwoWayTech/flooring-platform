import {
  companyEverPaid,
  companyPhase,
  PHASE_RANK,
  type LifecycleFacts,
  type LifecycleStatus,
  type LifecycleSubscription,
} from "../permissions/company-lifecycle";
import { phaseDates, phaseReachedAt, type LaterPhase } from "../permissions/lifecycle-dates";
import type {
  CompanyStatusAction,
  CompanyStatusActionView,
  CompanyStatusNext,
  PlatformAuditAction,
  PlatformCompanyStatus,
} from "../types/platform";
import { adminReasonProblem } from "./admin-reason";

/*
 * Suspend, reinstate and cancel a company from the console (docs/specs/platform-admin.md, part 2,
 * "Company status"; ADR 0056). One copy for the API (under its row locks), the status preview, the
 * web before the step-up and the demo. The rule only decides; reading the status and the
 * subscription rows, and writing `tenants.status`, is the caller's job. Nothing here reads the
 * life cycle a second way: every phase and date comes from `companyPhase` and `phaseDates`.
 */

/** The three status actions in the order the console lists them. */
export const COMPANY_STATUS_ACTIONS: readonly CompanyStatusAction[] = ["suspend", "reinstate", "cancel"];

/** The five statuses the console knows (blueprint p29, p40). `tenants.status` has no CHECK. */
export const LIFECYCLE_STATUSES: readonly LifecycleStatus[] = ["trial", "active", "past_due", "suspended", "cancelled"];

/** Whether stored or sent text is one of the five statuses the console knows. */
export function isLifecycleStatus(value: unknown): value is LifecycleStatus {
  return LIFECYCLE_STATUSES.some((status) => status === value);
}

/** The length of `expectedStatus`, the status text the admin saw (spec part 2, Bodies). */
export const EXPECTED_STATUS_LENGTH = { min: 1, max: 40 } as const;

/**
 * Every message of the status actions (spec "Validations and messages (part 2)"): the API's 400,
 * 409 and 422, the preview, the dialog and the demo say the same.
 */
export const STATUS_ACTION_MESSAGES = {
  expectedStatus: "Read the company's status again before changing it.",
  confirmName: "Type the company's name exactly to confirm.",
  changedMeanwhile: "This company's status changed meanwhile. Read it again.",
  unknownStatus: "This company's status isn't one the console knows, so it can't be changed here.",
  alreadySuspended: "This company is already suspended.",
  alreadyCancelled: "This company is already cancelled.",
  suspendCancelled: "A cancelled company can't be suspended. Reinstate it first if it should be suspended instead.",
  notStopped: "This company isn't suspended or cancelled, so there is nothing to reinstate.",
  noPlan:
    "This company has never had a plan. Suspending or cancelling it would also switch off every module but Platform, so its people couldn't read or export their data. To limit it now, switch its modules off on its Access page. This waits for the owner's decision.",
  noPlanReinstate:
    "This company has never had a plan, so the console can't tell what to put back. This waits for the owner's decision.",
  widens:
    "That would give this company more time before it becomes read only or locked than it has now, so nothing was changed.",
} as const;

type StatusMessageKey = keyof typeof STATUS_ACTION_MESSAGES;

/** What `statusAfter` reads: the life-cycle facts and the database's transaction time. */
export interface StatusActionFacts {
  statusChangedAt: Date;
  /** Every subscription row, deleted ones included, as TenantDirectory reads them. */
  subscriptions: readonly LifecycleSubscription[];
  /** The database's transaction time, the moment the status trigger will stamp. */
  now: Date;
}

/** Why a status action is refused: a state the action doesn't fit (409) or a broken rule (422). */
export type StatusActionRefusal =
  { status: 409; code: "conflict"; message: string } | { status: 422; code: "rule_broken"; message: string };

/** The status an action writes, with the life-cycle facts after it, or why it is refused. */
export type StatusAfter =
  | { ok: true; status: "suspended" | "cancelled" | "active" | "trial"; after: LifecycleFacts }
  | { ok: false; refusal: StatusActionRefusal };

function conflict(key: StatusMessageKey): StatusActionRefusal {
  return { status: 409, code: "conflict", message: STATUS_ACTION_MESSAGES[key] };
}

function ruleBroken(key: StatusMessageKey): StatusActionRefusal {
  return { status: 422, code: "rule_broken", message: STATUS_ACTION_MESSAGES[key] };
}

/**
 * Which transitions are refused with 409 (spec part 2, `statusAfter` check 2). The same status twice
 * is always refused, so every action that succeeds changes the status and the trigger stamps
 * `status_changed_at`. Suspending a cancelled company would widen it (a paid company's 90 days
 * would become read only for good, an unpaid one's 30 days would restart), so it is refused too.
 */
const TRANSITION_REFUSALS: Readonly<
  Record<LifecycleStatus, Readonly<Record<CompanyStatusAction, StatusMessageKey | null>>>
> = {
  trial: { suspend: null, reinstate: "notStopped", cancel: null },
  active: { suspend: null, reinstate: "notStopped", cancel: null },
  past_due: { suspend: null, reinstate: "notStopped", cancel: null },
  suspended: { suspend: "alreadySuspended", reinstate: null, cancel: null },
  cancelled: { suspend: "suspendCancelled", reinstate: null, cancel: "alreadyCancelled" },
};

/**
 * The status an allowed action writes (spec part 2, `statusAfter` check 5). Reinstate restores what
 * the rows say: `active` when the company ever paid, else `trial`. `past_due` is never written; the
 * rows say whether a payment is overdue (owner question 35).
 */
function nextStatus(
  action: CompanyStatusAction,
  subscriptions: readonly LifecycleSubscription[],
): "suspended" | "cancelled" | "active" | "trial" {
  if (action === "suspend") return "suspended";
  if (action === "cancel") return "cancelled";
  return companyEverPaid(subscriptions) ? "active" : "trial";
}

const LATER_PHASES: readonly LaterPhase[] = ["read_only", "locked"];

/**
 * When the company reaches `target` or a stricter phase: `now` when it already has, the boundary
 * `phaseReachedAt` finds otherwise, and never (infinity) when it never gets there.
 */
function reachedAt(facts: LifecycleFacts, now: Date, target: LaterPhase): number {
  if (PHASE_RANK[companyPhase(facts, now)] <= PHASE_RANK[target]) return now.getTime();
  return phaseReachedAt(facts, now, target)?.getTime() ?? Number.POSITIVE_INFINITY;
}

/**
 * Whether the facts after an action reach read only or locked later than the facts before it
 * (spec part 2, `statusAfter` check 4, "Never widen"). Worked out from `companyPhase` itself, so
 * there is no second copy of the ladder (ADR 0054's rule).
 */
function widens(before: LifecycleFacts, after: LifecycleFacts, now: Date): boolean {
  return LATER_PHASES.some((target) => reachedAt(after, now, target) > reachedAt(before, now, target));
}

/**
 * What a status action does, or why it is refused (docs/specs/platform-admin.md, part 2,
 * "`statusAfter`: the shared rule"). The first check that applies wins:
 * 1. a stored status the console doesn't know: 422 `unknownStatus`;
 * 2. a transition `TRANSITION_REFUSALS` refuses: 409;
 * 3. a company with no subscription row at all, deleted ones included: 422 `noPlan` (suspend and
 *    cancel) or `noPlanReinstate`. The access rule gives a rowless company every module only while
 *    it is a `trial` (`freshTrial`, `planModulesOf`), so suspending or cancelling one would switch
 *    off every module but Platform and its people couldn't read or export (owner question 34);
 * 4. suspend and cancel only: an action that would make the company read only or locked later than
 *    it already would be: 422 `widens` (owner question 37);
 * 5. otherwise the next status, with the facts after it: `statusChangedAt` is `now`, what the
 *    trigger stamps. Reinstate never extends a period: the rows decide the phase after it.
 * The inputs are never changed.
 */
export function statusAfter(action: CompanyStatusAction, current: string, facts: StatusActionFacts): StatusAfter {
  if (!isLifecycleStatus(current)) return { ok: false, refusal: ruleBroken("unknownStatus") };
  const refusedTransition = TRANSITION_REFUSALS[current][action];
  if (refusedTransition) return { ok: false, refusal: conflict(refusedTransition) };
  if (facts.subscriptions.length === 0) {
    return { ok: false, refusal: ruleBroken(action === "reinstate" ? "noPlanReinstate" : "noPlan") };
  }
  const subscriptions = [...facts.subscriptions];
  const status = nextStatus(action, subscriptions);
  const after: LifecycleFacts = { status, statusChangedAt: new Date(facts.now.getTime()), subscriptions };
  if (action !== "reinstate") {
    const before: LifecycleFacts = { status: current, statusChangedAt: facts.statusChangedAt, subscriptions };
    if (widens(before, after, facts.now)) return { ok: false, refusal: ruleBroken("widens") };
  }
  return { ok: true, status, after };
}

/**
 * The 409 when the status the admin saw is stale, else null (spec part 2, "Stale status"):
 * - `expected` is not the stored status: another admin changed it after this admin read it; or
 * - `now`, the transaction's start, is earlier than the stored `status_changed_at`: this
 *   transaction started before another admin's change committed and lost the race. A moment that
 *   can't be read refuses too (deny by default).
 * It runs after the 404 and the name check, and before `statusAfter`.
 */
export function staleStatusRefusal(
  expected: string,
  current: string,
  statusChangedAt: Date,
  now: Date,
): StatusActionRefusal | null {
  if (expected !== current) return conflict("changedMeanwhile");
  return now.getTime() >= statusChangedAt.getTime() ? null : conflict("changedMeanwhile");
}

/** A date as an ISO moment, or null. */
function isoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/** The phase and dates `companyPhase` and `phaseDates` give at `now`. */
function standingOf(facts: LifecycleFacts, now: Date): Omit<CompanyStatusNext, "status"> {
  const dates = phaseDates(facts, now);
  return {
    phase: companyPhase(facts, now),
    readOnlyFrom: isoOrNull(dates.readOnlyFrom),
    lockedFrom: isoOrNull(dates.lockedFrom),
  };
}

/**
 * A stored status the console doesn't know gives no access, as `companyPhase`'s default branch
 * gives TenantDirectory (deny by default): locked now, so no date is still to come.
 */
const UNKNOWN_STATUS_STANDING: Omit<CompanyStatusNext, "status"> = {
  phase: "locked",
  readOnlyFrom: null,
  lockedFrom: null,
};

function actionView(action: CompanyStatusAction, current: string, facts: StatusActionFacts): CompanyStatusActionView {
  const result = statusAfter(action, current, facts);
  if (!result.ok) {
    return { action, refusal: { code: result.refusal.code, message: result.refusal.message }, next: null };
  }
  return { action, refusal: null, next: { status: result.status, ...standingOf(result.after, facts.now) } };
}

/**
 * The status preview, the body of `GET /platform/companies/:id/status` (spec part 2,
 * "PlatformCompanyStatus"), for the API and the demo: the stored status text as it is, the phase
 * and dates now, and for each of the three actions, in order, its refusal or what it would give.
 * `facts.now` is the database's time in the API.
 */
export function companyStatusView(companyId: string, current: string, facts: StatusActionFacts): PlatformCompanyStatus {
  const standing = isLifecycleStatus(current)
    ? standingOf(
        { status: current, statusChangedAt: facts.statusChangedAt, subscriptions: facts.subscriptions },
        facts.now,
      )
    : UNKNOWN_STATUS_STANDING;
  return {
    companyId,
    status: current,
    statusChangedAt: facts.statusChangedAt.toISOString(),
    ...standing,
    actions: COMPANY_STATUS_ACTIONS.map((action) => actionView(action, current, facts)),
  };
}

/** The platform audit action each status action writes (spec "Audit (part 2)"). */
export const COMPANY_STATUS_AUDIT_ACTIONS = {
  suspend: "company.suspended",
  reinstate: "company.reinstated",
  cancel: "company.cancelled",
} as const satisfies Record<CompanyStatusAction, PlatformAuditAction>;

/** A company's status and when it last changed, as a status audit row records them. */
export interface StatusStamp {
  status: string;
  statusChangedAt: Date;
}

/**
 * The `before` and `after` of a status audit row (spec "Audit (part 2)"), one copy for the API and
 * the demo: `{ status, statusChangedAt }` before, the same plus the trimmed reason after, with ISO
 * moments, so `platformAuditDetails` reads both the same way.
 */
export function companyStatusAuditBody(
  before: StatusStamp,
  after: StatusStamp,
  reason: string,
): {
  before: { status: string; statusChangedAt: string };
  after: { status: string; statusChangedAt: string; reason: string };
} {
  return {
    before: { status: before.status, statusChangedAt: before.statusChangedAt.toISOString() },
    after: { status: after.status, statusChangedAt: after.statusChangedAt.toISOString(), reason: reason.trim() },
  };
}

/** A status action's fields as they arrive, before they are checked. */
export interface StatusActionFields {
  reason?: unknown;
  expectedStatus?: unknown;
  confirmName?: unknown;
}

/**
 * Why a status action's body is refused, or null (spec part 2, refusal order step 5): checked
 * before the company is read. In the spec's order: `expectedStatus` a string of 1 to 40
 * characters, exactly as sent; then the reason (`adminReasonProblem`); then, for cancel only,
 * `confirmName` a string. Suspend and reinstate take no `confirmName`; the API's strict schema
 * refuses it as an unknown field.
 */
export function statusActionBodyProblem(action: CompanyStatusAction, input: StatusActionFields): string | null {
  const expected = input.expectedStatus;
  if (
    typeof expected !== "string" ||
    expected.length < EXPECTED_STATUS_LENGTH.min ||
    expected.length > EXPECTED_STATUS_LENGTH.max
  ) {
    return STATUS_ACTION_MESSAGES.expectedStatus;
  }
  const reasonProblem = adminReasonProblem(input.reason);
  if (reasonProblem) return reasonProblem;
  if (action === "cancel" && typeof input.confirmName !== "string") return STATUS_ACTION_MESSAGES.confirmName;
  return null;
}

/**
 * Why a cancel's typed name is refused, or null (spec part 2, refusal order step 8): trimmed, it
 * must equal the company's name trimmed, case-sensitive, and not be empty.
 */
export function confirmNameProblem(input: StatusActionFields, companyName: string): string | null {
  const typed = typeof input.confirmName === "string" ? input.confirmName.trim() : "";
  return typed.length > 0 && typed === companyName.trim() ? null : STATUS_ACTION_MESSAGES.confirmName;
}

/** The body check, then for cancel the name check: what the web runs before the step-up, and the demo. */
export function statusActionInputProblem(
  action: CompanyStatusAction,
  input: StatusActionFields,
  companyName: string,
): string | null {
  const bodyProblem = statusActionBodyProblem(action, input);
  if (bodyProblem) return bodyProblem;
  return action === "cancel" ? confirmNameProblem(input, companyName) : null;
}

/** The status dialog's title and body. */
export interface StatusActionText {
  title: string;
  body: string;
}

const ACTION_VERBS: Readonly<Record<CompanyStatusAction, string>> = {
  suspend: "Suspend",
  reinstate: "Reinstate",
  cancel: "Cancel",
};

const READ_ONLY_FROM_NOW = "Read only from now: its people can sign in, read and export, but not change anything.";

/** What the company may do after the action, in words. */
function phaseSentence(next: CompanyStatusNext, formatDate: (iso: string) => string): string {
  switch (next.phase) {
    case "full":
      return "It is in full use after this.";
    case "read_only":
      return next.lockedFrom
        ? `${READ_ONLY_FROM_NOW} It locks on ${formatDate(next.lockedFrom)}.`
        : `${READ_ONLY_FROM_NOW} It stays read only until it is reinstated.`;
    case "locked":
      return "Locked from now: its people can sign in but can't open its data.";
  }
}

/**
 * The status dialog's words (spec part 2, "The status dialog"), from the preview's `next`, so the
 * demo and api mode say the same. Dates go through `formatDate`. Cancel says nothing is deleted;
 * a reinstate whose plan has lapsed says it stays read only or locked, because reinstate never
 * extends a period and the console can't record a payment yet.
 */
export function statusActionText(
  action: CompanyStatusAction,
  next: CompanyStatusNext,
  name: string,
  formatDate: (iso: string) => string,
): StatusActionText {
  const sentences = [phaseSentence(next, formatDate)];
  if (action === "cancel") {
    sentences.push(
      "Nothing is deleted: its database, people, plans and settings stay. Reinstate puts the status back.",
    );
  }
  if (action === "reinstate" && next.phase !== "full") {
    const stays = next.phase === "locked" ? "locked" : "read only";
    sentences.push(
      `Its plan has ended, so it stays ${stays} until a payment is recorded, which the console can't do yet.`,
    );
  }
  return { title: `${ACTION_VERBS[action]} ${name}?`, body: sentences.join(" ") };
}
