import { describe, expect, it } from "vitest";
import {
  companyPhase,
  PHASE_RANK,
  type LifecycleFacts,
  type LifecycleStatus,
  type LifecycleSubscription,
} from "../src/permissions/company-lifecycle";
import { lifecycleHorizon, phaseDates } from "../src/permissions/lifecycle-dates";
import { ADMIN_REASON_MESSAGE } from "../src/platform/admin-reason";
import { platformAuditDetails } from "../src/platform/audit-details";
import { ownerBillingNotice } from "../src/platform/company-billing";
import { companyStandingState } from "../src/platform/company-standing";
import {
  COMPANY_STATUS_ACTION_LABELS,
  COMPANY_STATUS_ACTIONS,
  COMPANY_STATUS_AUDIT_ACTIONS,
  companyStatusAuditBody,
  companyStatusView,
  confirmNameProblem,
  STATUS_ACTION_MESSAGES,
  staleStatusRefusal,
  statusActionBodyProblem,
  statusActionInputProblem,
  statusActionText,
  statusAfter,
  type StatusActionFacts,
  type StatusAfter,
} from "../src/platform/company-status";
import type { CompanyStatusAction, CompanyStatusNext } from "../src/types/platform";

const DAY = 86_400_000;
const now = new Date("2026-11-15T12:00:00.000Z");
const inDays = (days: number) => new Date(now.getTime() + days * DAY);
const iso = (date: Date) => date.toISOString();
const M = STATUS_ACTION_MESSAGES;

/** A subscription row; by default a paid `active` row ending in 60 days, so its own lock is at +104 days. */
const row = (overrides: Partial<LifecycleSubscription> = {}): LifecycleSubscription => ({
  status: "active",
  currentPeriodEnd: inDays(60),
  price: "49.00",
  deleted: false,
  ...overrides,
});

/** A trial row, never paid, ending `days` from now. */
const trialRow = (days: number) => row({ status: "trial", price: "0.00", currentPeriodEnd: inDays(days) });

const facts = (subscriptions: LifecycleSubscription[], changedDaysAgo = 100): StatusActionFacts => ({
  statusChangedAt: inDays(-changedDaysAgo),
  subscriptions,
  now,
});

/** The facts after an allowed action; fails the test when the action was refused. */
function allowed(result: StatusAfter): LifecycleFacts {
  if (!result.ok) throw new Error(`refused: ${result.refusal.message}`);
  return result.after;
}

const conflict = (message: string) => ({ ok: false, refusal: { status: 409, code: "conflict", message } });
const ruleBroken = (message: string) => ({ ok: false, refusal: { status: 422, code: "rule_broken", message } });

describe("statusAfter: the transition table (spec part 2, check 2; CS-1)", () => {
  const paid = facts([row()]);
  const expected: Record<LifecycleStatus, Record<CompanyStatusAction, string>> = {
    trial: { suspend: "suspended", reinstate: M.notStopped, cancel: "cancelled" },
    active: { suspend: "suspended", reinstate: M.notStopped, cancel: "cancelled" },
    past_due: { suspend: "suspended", reinstate: M.notStopped, cancel: "cancelled" },
    suspended: { suspend: M.alreadySuspended, reinstate: "active", cancel: "cancelled" },
    cancelled: { suspend: M.suspendCancelled, reinstate: "active", cancel: M.alreadyCancelled },
  };

  for (const [current, byAction] of Object.entries(expected)) {
    for (const action of COMPANY_STATUS_ACTIONS) {
      const outcome = byAction[action];
      it(`${action} from ${current} gives ${outcome}`, () => {
        const result = statusAfter(action, current, paid);
        if (outcome.endsWith(".")) {
          expect(result).toEqual(conflict(outcome));
        } else {
          expect(result).toMatchObject({ ok: true, status: outcome });
          expect(allowed(result).status).toBe(outcome);
        }
      });
    }
  }
});

describe("statusAfter: refusals before the state check and without rows (CS-2, CS-3)", () => {
  it("refuses a status the console doesn't know with 422, before the state check", () => {
    for (const current of ["frozen", "", "ACTIVE", "toString"]) {
      for (const action of COMPANY_STATUS_ACTIONS) {
        expect(statusAfter(action, current, facts([row()]))).toEqual(ruleBroken(M.unknownStatus));
      }
    }
  });

  it("refuses to suspend or cancel a company that never had a plan, naming its Access page", () => {
    for (const current of ["trial", "active", "past_due"]) {
      expect(statusAfter("suspend", current, facts([]))).toEqual(ruleBroken(M.noPlan));
      expect(statusAfter("cancel", current, facts([]))).toEqual(ruleBroken(M.noPlan));
    }
    expect(M.noPlan).toContain("switch its modules off on its Access page");
    expect(statusAfter("cancel", "suspended", facts([]))).toEqual(ruleBroken(M.noPlan));
  });

  it("refuses to reinstate a company that never had a plan, after the state check", () => {
    expect(statusAfter("reinstate", "suspended", facts([]))).toEqual(ruleBroken(M.noPlanReinstate));
    expect(statusAfter("reinstate", "cancelled", facts([]))).toEqual(ruleBroken(M.noPlanReinstate));
    expect(statusAfter("reinstate", "trial", facts([]))).toEqual(conflict(M.notStopped));
    expect(statusAfter("suspend", "suspended", facts([]))).toEqual(conflict(M.alreadySuspended));
  });

  it("lets a company with only a deleted row be suspended: it is not a fresh trial", () => {
    expect(statusAfter("suspend", "active", facts([row({ deleted: true })]))).toMatchObject({
      ok: true,
      status: "suspended",
    });
  });
});

describe("statusAfter: what reinstate writes (CS-4)", () => {
  const reinstated = (rows: LifecycleSubscription[]) => statusAfter("reinstate", "suspended", facts(rows));

  it("gives active when any row, deleted ones included, was paid", () => {
    for (const rows of [
      [row()],
      [row({ status: "past_due" })],
      [row({ deleted: true }), trialRow(10)],
      [row({ status: "cancelled", price: "12.00", currentPeriodEnd: inDays(-5) })],
      [row({ price: "0.00" })],
    ]) {
      expect(reinstated(rows)).toMatchObject({ ok: true, status: "active" });
    }
  });

  it("gives trial when no row was ever paid, and never past_due", () => {
    expect(reinstated([trialRow(10), trialRow(-40)])).toMatchObject({ ok: true, status: "trial" });
    expect(reinstated([row({ status: "cancelled", price: "0.00" })])).toMatchObject({ ok: true, status: "trial" });
    expect(statusAfter("reinstate", "cancelled", facts([row({ status: "past_due" })]))).toMatchObject({
      status: "active",
    });
  });
});

/** A small seeded PRNG (mulberry32), so the property test is the same on every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

describe("statusAfter: never widen (spec part 2, check 4; CS-5)", () => {
  it("refuses to cancel a never-paid suspension while its own 30 days bind", () => {
    // Suspended 20 days ago, so it locks in 10 days; the trial row would lock only in 40.
    expect(statusAfter("cancel", "suspended", facts([trialRow(10)], 20))).toEqual(ruleBroken(M.widens));
  });

  it("allows it when the rows lock first, and allows cancelling a paid suspension", () => {
    // The trial row ended 25 days ago, so the rows lock in 5 days before and after.
    expect(statusAfter("cancel", "suspended", facts([trialRow(-25)], 20))).toMatchObject({ ok: true });
    expect(statusAfter("cancel", "suspended", facts([row()], 300))).toMatchObject({ ok: true, status: "cancelled" });
  });

  it("never refuses suspend or cancel from a full status with widens, and never loosens the phase", () => {
    const random = seeded(20261115);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
    const statuses = ["trial", "active", "past_due"] as const;
    const rowStatuses = ["trial", "active", "past_due", "cancelled"] as const;
    for (let sample = 0; sample < 500; sample += 1) {
      const rows = Array.from({ length: 1 + Math.floor(random() * 3) }, () =>
        row({
          status: pick(rowStatuses),
          currentPeriodEnd: inDays(Math.round(random() * 600) - 200),
          price: pick(["0.00", "12.00"]),
          deleted: random() < 0.25,
        }),
      );
      const current = pick(statuses);
      const input = facts(rows, Math.round(random() * 400));
      const before: LifecycleFacts = { status: current, statusChangedAt: input.statusChangedAt, subscriptions: rows };
      for (const action of ["suspend", "cancel"] as const) {
        const after = allowed(statusAfter(action, current, input));
        const horizon = lifecycleHorizon(after, now).getTime();
        for (let step = 0; step < 40; step += 1) {
          const at = new Date(now.getTime() + Math.floor(((horizon - now.getTime()) * step) / 39));
          expect(PHASE_RANK[companyPhase(after, at)]).toBeLessThanOrEqual(PHASE_RANK[companyPhase(before, at)]);
        }
      }
    }
  });
});

describe("statusAfter: the phases after each action (CS-6)", () => {
  const lockedFrom = (result: StatusAfter) => phaseDates(allowed(result), now).lockedFrom;

  it("suspends a paid company read only until its rows' own lock", () => {
    const after = allowed(statusAfter("suspend", "active", facts([row()])));
    expect(companyPhase(after, now)).toBe("read_only");
    expect(companyPhase(after, inDays(100))).toBe("read_only");
    expect(companyPhase(after, new Date(inDays(104).getTime() - 1))).toBe("read_only");
    expect(companyPhase(after, inDays(104))).toBe("locked");
    expect(lockedFrom(statusAfter("suspend", "active", facts([row()])))).toEqual(inDays(104));
    expect(lockedFrom(statusAfter("suspend", "active", facts([row({ currentPeriodEnd: inDays(20) })])))).toEqual(
      inDays(64),
    );
  });

  it("suspends a never-paid company read only for 30 days, or until its rows lock sooner", () => {
    const after = allowed(statusAfter("suspend", "trial", facts([trialRow(10)])));
    expect(companyPhase(after, now)).toBe("read_only");
    expect(companyPhase(after, new Date(inDays(30).getTime() - 1))).toBe("read_only");
    expect(companyPhase(after, inDays(30))).toBe("locked");
    expect(lockedFrom(statusAfter("suspend", "trial", facts([trialRow(-25)])))).toEqual(inDays(5));
  });

  it("cancels a paid company read only for 90 days, or until its rows lock sooner", () => {
    expect(lockedFrom(statusAfter("cancel", "active", facts([row()])))).toEqual(inDays(90));
    expect(lockedFrom(statusAfter("cancel", "active", facts([row({ currentPeriodEnd: inDays(20) })])))).toEqual(
      inDays(64),
    );
  });

  it("cancels a never-paid company read only for 30 days, or until its rows lock sooner", () => {
    expect(lockedFrom(statusAfter("cancel", "trial", facts([trialRow(10)])))).toEqual(inDays(30));
    expect(lockedFrom(statusAfter("cancel", "trial", facts([trialRow(-25)])))).toEqual(inDays(5));
  });

  it("reinstates to the rows' phase: full with a current row, read only with a lapsed paid row", () => {
    expect(companyPhase(allowed(statusAfter("reinstate", "suspended", facts([row()]))), now)).toBe("full");
    const lapsed = [row({ currentPeriodEnd: inDays(-20) })];
    expect(companyPhase(allowed(statusAfter("reinstate", "suspended", facts(lapsed))), now)).toBe("read_only");
  });
});

describe("statusAfter: the facts after (CS-7)", () => {
  it("stamps the change at the database's time and changes none of its inputs", () => {
    const rows = [Object.freeze(row()), Object.freeze(trialRow(-3))];
    const input: StatusActionFacts = Object.freeze({
      statusChangedAt: inDays(-10),
      subscriptions: Object.freeze(rows),
      now,
    });
    const copy = structuredClone(input);
    for (const [action, current] of [
      ["suspend", "active"],
      ["reinstate", "suspended"],
      ["cancel", "past_due"],
    ] as const) {
      const after = allowed(statusAfter(action, current, input));
      expect(after.statusChangedAt.getTime()).toBe(now.getTime());
      expect(after.subscriptions).toEqual(rows);
    }
    expect(input).toEqual(copy);
  });
});

describe("statusAfter: how part 4 reads each result (CS-8)", () => {
  const standing = (after: LifecycleFacts, at: Date = now) => {
    const phase = companyPhase(after, at);
    return companyStandingState({ maintenanceMode: false, databaseUsable: true, readOnly: phase !== "full", phase });
  };
  const notice = (after: LifecycleFacts, at: Date = now) =>
    ownerBillingNotice({ facts: after, databaseReadOnly: false, now: at });

  it("shows a suspension and a cancel as read only with their reasons and lock dates", () => {
    const suspended = allowed(statusAfter("suspend", "active", facts([row()])));
    expect(standing(suspended)).toBe("read_only");
    expect(notice(suspended)).toEqual({
      kind: "read_only",
      reason: "suspended",
      since: null,
      lockedFrom: iso(inDays(104)),
    });
    const cancelled = allowed(statusAfter("cancel", "active", facts([row()])));
    expect(notice(cancelled)).toEqual({
      kind: "read_only",
      reason: "cancelled",
      since: null,
      lockedFrom: iso(inDays(90)),
    });
    const unpaid = allowed(statusAfter("suspend", "trial", facts([trialRow(10)])));
    expect(notice(unpaid)).toMatchObject({ reason: "suspended", lockedFrom: iso(inDays(30)) });
    expect(standing(unpaid, inDays(31))).toBe("locked");
  });

  it("shows a reinstated company with a current row in full use with no notice", () => {
    const reinstated = allowed(statusAfter("reinstate", "suspended", facts([row()])));
    expect(standing(reinstated)).toBe("full");
    expect(notice(reinstated)).toBeNull();
  });

  it("drops the payment-overdue notice of a stored past_due company that is suspended and reinstated", () => {
    const rows = [row()];
    const pastDue: LifecycleFacts = { status: "past_due", statusChangedAt: inDays(-100), subscriptions: rows };
    expect(notice(pastDue)).toMatchObject({ kind: "payment_overdue" });
    const suspended = allowed(statusAfter("suspend", "past_due", facts(rows)));
    const later = inDays(1);
    const reinstate = statusAfter("reinstate", "suspended", {
      statusChangedAt: suspended.statusChangedAt,
      subscriptions: rows,
      now: later,
    });
    const reinstated = allowed(reinstate);
    expect(reinstated.status).toBe("active");
    expect(notice(reinstated, later)).toBeNull();
    expect(companyPhase(pastDue, later)).toBe("full");
    expect(companyPhase(reinstated, later)).toBe("full");
  });
});

describe("companyStatusView, the preview (CS-9)", () => {
  const COMPANY = "0196f3a2-7c1d-7e4b-9a10-2b3c4d5e6f71";

  /** What `next` must be for an allowed action: `statusAfter`, then `companyPhase` and `phaseDates`. */
  function expectedNext(action: CompanyStatusAction, current: string, input: StatusActionFacts) {
    const after = allowed(statusAfter(action, current, input));
    const dates = phaseDates(after, now);
    return {
      status: after.status,
      phase: companyPhase(after, now),
      readOnlyFrom: dates.readOnlyFrom ? iso(dates.readOnlyFrom) : null,
      lockedFrom: dates.lockedFrom ? iso(dates.lockedFrom) : null,
    };
  }

  it("previews a paid active company: the phase now and each action in order", () => {
    const input = facts([row()]);
    const view = companyStatusView(COMPANY, "active", input);
    expect(view).toEqual({
      companyId: COMPANY,
      status: "active",
      statusChangedAt: iso(inDays(-100)),
      phase: "full",
      readOnlyFrom: iso(inDays(74)),
      lockedFrom: iso(inDays(104)),
      actions: [
        { action: "suspend", refusal: null, next: expectedNext("suspend", "active", input) },
        { action: "reinstate", refusal: { code: "conflict", message: M.notStopped }, next: null },
        { action: "cancel", refusal: null, next: expectedNext("cancel", "active", input) },
      ],
    });
    expect(view.actions[0]?.next).toEqual({
      status: "suspended",
      phase: "read_only",
      readOnlyFrom: null,
      lockedFrom: iso(inDays(104)),
    });
    expect(view.actions[2]?.next).toMatchObject({ status: "cancelled", lockedFrom: iso(inDays(90)) });
  });

  it("previews a never-paid suspension: cancel refused as widening, reinstate back to trial", () => {
    const input = facts([trialRow(10)], 5);
    const view = companyStatusView(COMPANY, "suspended", input);
    expect(view.phase).toBe("read_only");
    expect(view.lockedFrom).toBe(iso(inDays(25)));
    expect(view.actions.map((a) => a.action)).toEqual(["suspend", "reinstate", "cancel"]);
    expect(view.actions[0]).toEqual({
      action: "suspend",
      refusal: { code: "conflict", message: M.alreadySuspended },
      next: null,
    });
    expect(view.actions[1]?.next).toEqual(expectedNext("reinstate", "suspended", input));
    expect(view.actions[1]?.next).toMatchObject({ status: "trial", phase: "full", readOnlyFrom: iso(inDays(10)) });
    expect(view.actions[2]).toEqual({
      action: "cancel",
      refusal: { code: "rule_broken", message: M.widens },
      next: null,
    });
  });

  it("previews a stored status the console doesn't know as locked, with the text as it is", () => {
    const view = companyStatusView(COMPANY, "frozen", facts([row()]));
    expect(view).toMatchObject({ status: "frozen", phase: "locked", readOnlyFrom: null, lockedFrom: null });
    for (const action of view.actions) {
      expect(action).toMatchObject({ refusal: { code: "rule_broken", message: M.unknownStatus }, next: null });
    }
  });
});

describe("the status action's input checks (CS-10)", () => {
  const body = (overrides: Record<string, unknown> = {}) => ({
    reason: "Asked by the owner by phone",
    expectedStatus: "active",
    ...overrides,
  });

  it("bounds the reason at 10 to 500 characters after trimming", () => {
    expect(statusActionBodyProblem("suspend", body({ reason: "r".repeat(9) }))).toBe(ADMIN_REASON_MESSAGE);
    expect(statusActionBodyProblem("suspend", body({ reason: "r".repeat(10) }))).toBeNull();
    expect(statusActionBodyProblem("suspend", body({ reason: "r".repeat(500) }))).toBeNull();
    expect(statusActionBodyProblem("suspend", body({ reason: "r".repeat(501) }))).toBe(ADMIN_REASON_MESSAGE);
    expect(statusActionBodyProblem("suspend", body({ reason: " ".repeat(20) }))).toBe(ADMIN_REASON_MESSAGE);
    expect(statusActionBodyProblem("suspend", body({ reason: undefined }))).toBe(ADMIN_REASON_MESSAGE);
  });

  it("needs the status the admin saw: text of 1 to 40 characters, even one the console doesn't know", () => {
    for (const expectedStatus of [undefined, "", "x".repeat(41), 5, null]) {
      expect(statusActionBodyProblem("reinstate", body({ expectedStatus }))).toBe(M.expectedStatus);
    }
    expect(statusActionBodyProblem("reinstate", body({ expectedStatus: "frozen" }))).toBeNull();
    expect(statusActionBodyProblem("reinstate", body({ expectedStatus: "x".repeat(40) }))).toBeNull();
    // The spec's order: the status the admin saw, then the reason.
    expect(statusActionBodyProblem("suspend", body({ expectedStatus: "", reason: "short" }))).toBe(M.expectedStatus);
  });

  it("needs the company's name typed exactly to cancel, trimmed and case-sensitive", () => {
    const name = "Summit Floor Co.";
    expect(statusActionBodyProblem("cancel", body())).toBe(M.confirmName);
    expect(statusActionInputProblem("cancel", body({ confirmName: name }), name)).toBeNull();
    expect(statusActionInputProblem("cancel", body({ confirmName: `  ${name}  ` }), name)).toBeNull();
    expect(statusActionInputProblem("cancel", body({ confirmName: "summit floor co." }), name)).toBe(M.confirmName);
    expect(statusActionInputProblem("cancel", body(), name)).toBe(M.confirmName);
    expect(statusActionInputProblem("cancel", body({ confirmName: name, reason: "short" }), name)).toBe(
      ADMIN_REASON_MESSAGE,
    );
    expect(confirmNameProblem({ confirmName: "   " }, "   ")).toBe(M.confirmName);
    expect(confirmNameProblem({ confirmName: 42 }, name)).toBe(M.confirmName);
  });

  it("asks no name to suspend or reinstate", () => {
    expect(statusActionInputProblem("suspend", body(), "Summit Floor Co.")).toBeNull();
    expect(statusActionInputProblem("reinstate", body({ expectedStatus: "suspended" }), "Summit Floor Co.")).toBeNull();
  });
});

describe("statusActionText, the dialog's words (CS-11)", () => {
  const format = (value: string) => `on ${value.slice(0, 10)}`;
  const next = (overrides: Partial<CompanyStatusNext>): CompanyStatusNext => ({
    status: "suspended",
    phase: "read_only",
    readOnlyFrom: null,
    lockedFrom: null,
    ...overrides,
  });
  const READ_ONLY = "Read only from now: its people can sign in, read and export, but not change anything.";

  it("says what the company may do after each action", () => {
    expect(
      statusActionText("reinstate", next({ status: "active", phase: "full" }), "Summit Floor Co.", format),
    ).toEqual({ title: "Reinstate Summit Floor Co.?", body: "It is in full use after this." });
    expect(statusActionText("suspend", next({ lockedFrom: iso(inDays(30)) }), "Summit", format)).toEqual({
      title: "Suspend Summit?",
      body: `${READ_ONLY} It locks on on ${iso(inDays(30)).slice(0, 10)}.`,
    });
    expect(statusActionText("suspend", next({}), "Summit", format).body).toBe(
      `${READ_ONLY} It stays read only until it is reinstated.`,
    );
    expect(statusActionText("suspend", next({ phase: "locked" }), "Summit", format).body).toBe(
      "Locked from now: its people can sign in but can't open its data.",
    );
  });

  it("says a cancel deletes nothing, and a reinstate with a lapsed plan stays read only or locked", () => {
    const cancel = statusActionText(
      "cancel",
      next({ status: "cancelled", lockedFrom: iso(inDays(90)) }),
      "Summit",
      format,
    );
    expect(cancel.title).toBe("Cancel Summit?");
    expect(cancel.body).toContain(
      "Nothing is deleted: its database, people, plans and settings stay. Reinstate puts the status back.",
    );
    const lapsed = statusActionText(
      "reinstate",
      next({ status: "active", lockedFrom: iso(inDays(20)) }),
      "Summit",
      format,
    );
    expect(lapsed.body).toMatch(
      /Its plan has ended, so it stays read only until a payment is recorded, which the console can't do yet\.$/,
    );
    const locked = statusActionText("reinstate", next({ status: "active", phase: "locked" }), "Summit", format);
    expect(locked.body).toContain("so it stays locked until a payment is recorded");
    expect(statusActionText("suspend", next({}), "Summit", format).body).not.toContain("Its plan has ended");
  });

  it("titles each action with the one shared label the button and the step-up also use", () => {
    expect(COMPANY_STATUS_ACTION_LABELS).toEqual({ suspend: "Suspend", reinstate: "Reinstate", cancel: "Cancel" });
    for (const action of COMPANY_STATUS_ACTIONS) {
      expect(statusActionText(action, next({}), "Summit", format).title).toBe(
        `${COMPANY_STATUS_ACTION_LABELS[action]} Summit?`,
      );
    }
  });
});

describe("staleStatusRefusal (spec part 2, Stale status; CS-12)", () => {
  const stamp = inDays(-1);

  it("passes the status the admin saw when no later change won the race", () => {
    expect(staleStatusRefusal("active", "active", stamp, now)).toBeNull();
    expect(staleStatusRefusal("active", "active", now, now)).toBeNull();
  });

  it("refuses a status that changed meanwhile, or a transaction that started before the stored change", () => {
    const changed = { status: 409, code: "conflict", message: M.changedMeanwhile };
    expect(staleStatusRefusal("active", "suspended", stamp, now)).toEqual(changed);
    expect(staleStatusRefusal("active", "active", now, new Date(now.getTime() - 1))).toEqual(changed);
    expect(staleStatusRefusal("active", "active", new Date(Number.NaN), now)).toEqual(changed);
  });
});

describe("the status audit body (spec Audit (part 2))", () => {
  it("records the status and stamp before and after with the trimmed reason, as the allow-list reads it", () => {
    const body = companyStatusAuditBody(
      { status: "active", statusChangedAt: inDays(-100) },
      { status: "suspended", statusChangedAt: now },
      "  Asked by the owner by phone  ",
    );
    expect(body).toEqual({
      before: { status: "active", statusChangedAt: iso(inDays(-100)) },
      after: { status: "suspended", statusChangedAt: iso(now), reason: "Asked by the owner by phone" },
    });
    expect(platformAuditDetails(COMPANY_STATUS_AUDIT_ACTIONS.suspend, body.before, body.after)).toEqual({
      kind: "status_changed",
      from: "active",
      to: "suspended",
      reason: "Asked by the owner by phone",
    });
    expect(COMPANY_STATUS_AUDIT_ACTIONS).toEqual({
      suspend: "company.suspended",
      reinstate: "company.reinstated",
      cancel: "company.cancelled",
    });
  });
});
