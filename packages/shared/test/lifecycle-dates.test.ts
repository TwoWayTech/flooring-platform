import { describe, expect, it } from "vitest";
import {
  companyPhase,
  PHASE_RANK,
  type LifecycleFacts,
  type LifecycleStatus,
  type LifecycleSubscription,
} from "../src/permissions/company-lifecycle";
import { lifecycleHorizon, phaseDates, phaseReachedAt } from "../src/permissions/lifecycle-dates";

const DAY = 86_400_000;
const now = new Date("2026-11-15T12:00:00Z");
const inDays = (days: number) => new Date(now.getTime() + days * DAY);
const plus = (date: Date, days: number) => new Date(date.getTime() + days * DAY);

const row = (overrides: Partial<LifecycleSubscription>): LifecycleSubscription => ({
  status: "active",
  currentPeriodEnd: inDays(30),
  price: "99.00",
  deleted: false,
  ...overrides,
});

const facts = (overrides: Partial<LifecycleFacts>): LifecycleFacts => ({
  status: "active",
  statusChangedAt: inDays(-400),
  subscriptions: [],
  ...overrides,
});

describe("phaseDates (platform-admin spec part 4, The dates)", () => {
  const cases: [string, LifecycleFacts, Date | null, Date | null][] = (() => {
    const soon = inDays(10);
    const ended3 = inDays(-3);
    const ended20 = inDays(-20);
    const trialEnd = inDays(5);
    const yearly = inDays(380);
    const since5 = inDays(-5);
    const since10 = inDays(-10);
    const end20 = inDays(20);
    const end300 = inDays(300);
    return [
      [
        "an active row ending in 10 days",
        facts({ subscriptions: [row({ currentPeriodEnd: soon })] }),
        plus(soon, 14),
        plus(soon, 44),
      ],
      [
        "an active row that ended 3 days ago",
        facts({ subscriptions: [row({ currentPeriodEnd: ended3 })] }),
        plus(ended3, 14),
        plus(ended3, 44),
      ],
      [
        "an active row that ended 20 days ago (already read only)",
        facts({ subscriptions: [row({ currentPeriodEnd: ended20 })] }),
        null,
        plus(ended20, 44),
      ],
      [
        "a trial row ending in 5 days",
        facts({ status: "trial", subscriptions: [row({ status: "trial", price: "0", currentPeriodEnd: trialEnd })] }),
        trialEnd,
        plus(trialEnd, 30),
      ],
      [
        "a yearly active row ending in 380 days",
        facts({ subscriptions: [row({ currentPeriodEnd: yearly })] }),
        plus(yearly, 14),
        plus(yearly, 44),
      ],
      [
        "suspended, no rows, 5 days ago",
        facts({ status: "suspended", statusChangedAt: since5 }),
        null,
        plus(since5, 30),
      ],
      [
        "suspended after paying, with an active row ending in 20 days",
        facts({ status: "suspended", statusChangedAt: since5, subscriptions: [row({ currentPeriodEnd: end20 })] }),
        null,
        plus(end20, 44),
      ],
      [
        "cancelled, no rows, 5 days ago",
        facts({ status: "cancelled", statusChangedAt: since5 }),
        null,
        plus(since5, 30),
      ],
      [
        "cancelled after paying, where the row's ladder binds",
        facts({ status: "cancelled", statusChangedAt: since10, subscriptions: [row({ currentPeriodEnd: end20 })] }),
        null,
        plus(end20, 44),
      ],
      [
        "cancelled after paying, where the status binds",
        facts({ status: "cancelled", statusChangedAt: since10, subscriptions: [row({ currentPeriodEnd: end300 })] }),
        null,
        plus(since10, 90),
      ],
      [
        "two active rows, one ended 20 days ago and one ending in 10 days",
        facts({ subscriptions: [row({ currentPeriodEnd: ended20 }), row({ currentPeriodEnd: soon })] }),
        plus(soon, 14),
        plus(soon, 44),
      ],
      [
        "only a deleted active row, which ended 20 days ago",
        facts({ subscriptions: [row({ currentPeriodEnd: ended20, deleted: true })] }),
        null,
        plus(ended20, 44),
      ],
      ["a fresh trial with no rows", facts({ status: "trial" }), null, null],
      ["an already locked company", facts({ subscriptions: [row({ currentPeriodEnd: inDays(-60) })] }), null, null],
    ];
  })();

  it.each(cases)("gives the dates for %s", (_name, input, readOnlyFrom, lockedFrom) => {
    expect(phaseDates(input, now)).toEqual({ readOnlyFrom, lockedFrom });
  });

  it("puts the cancelled-after-paying row case's lock 64 days away, before the status's 90 days", () => {
    const input = facts({
      status: "cancelled",
      statusChangedAt: inDays(-10),
      subscriptions: [row({ currentPeriodEnd: inDays(20) })],
    });
    expect(phaseDates(input, now).lockedFrom).toEqual(inDays(64));
  });

  it.each(cases)("is exact to the millisecond for %s", (_name, input) => {
    const { readOnlyFrom, lockedFrom } = phaseDates(input, now);
    if (readOnlyFrom) {
      expect(companyPhase(input, new Date(readOnlyFrom.getTime() - 1))).toBe("full");
      expect(companyPhase(input, readOnlyFrom)).not.toBe("full");
    }
    if (lockedFrom) {
      expect(companyPhase(input, new Date(lockedFrom.getTime() - 1))).toBe("read_only");
      expect(companyPhase(input, lockedFrom)).toBe("locked");
    }
  });

  it("sets lockedFrom whenever the company is read only", () => {
    for (const [name, input] of cases) {
      if (companyPhase(input, now) === "read_only") expect(phaseDates(input, now).lockedFrom, name).not.toBeNull();
    }
  });
});

describe("lifecycleHorizon", () => {
  it("is the latest anchor plus the sum of every period plus one day (165 days)", () => {
    expect(lifecycleHorizon(facts({}), now)).toEqual(inDays(165));
    const late = inDays(380);
    expect(lifecycleHorizon(facts({ subscriptions: [row({ currentPeriodEnd: late })] }), now)).toEqual(plus(late, 165));
    const changed = inDays(3);
    expect(lifecycleHorizon(facts({ statusChangedAt: changed }), now)).toEqual(plus(changed, 165));
  });

  it("leaves an end that can't be read out of the latest anchor", () => {
    const input = facts({ subscriptions: [row({ currentPeriodEnd: new Date(Number.NaN) })] });
    expect(lifecycleHorizon(input, now)).toEqual(inDays(165));
  });
});

/** A deterministic linear congruential generator (Numerical Recipes constants), so no library is needed. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

const STATUSES: readonly LifecycleStatus[] = ["trial", "active", "past_due", "suspended", "cancelled"];
const ROW_STATUSES: readonly LifecycleSubscription["status"][] = ["trial", "active", "past_due", "cancelled"];

/** One random set of facts around `now`: up to three rows, some deleted, ends and changes within a year. */
function randomFacts(next: () => number): LifecycleFacts {
  const pick = <T>(items: readonly T[]) => items[Math.floor(next() * items.length)]!;
  const offset = () => Math.round((next() * 2 - 1) * 400 * DAY);
  const count = Math.floor(next() * 4);
  return {
    status: pick(STATUSES),
    statusChangedAt: new Date(now.getTime() + offset()),
    subscriptions: Array.from({ length: count }, () => ({
      status: pick(ROW_STATUSES),
      currentPeriodEnd: new Date(now.getTime() + offset()),
      price: pick(["0", "0.00", "49.00", "10.00"]),
      deleted: next() < 0.25,
    })),
  };
}

describe("phase dates over 500 seeded random fact sets", () => {
  const next = lcg(20261115);
  const samples = Array.from({ length: 500 }, () => randomFacts(next));

  it("never steps the phase up as time passes", () => {
    for (const input of samples) {
      let previous = PHASE_RANK.full;
      for (let step = 0; step < 50; step += 1) {
        const rank = PHASE_RANK[companyPhase(input, inDays(-400 + step * 25))];
        expect(rank).toBeLessThanOrEqual(previous);
        previous = rank;
      }
    }
  });

  it("no longer changes the phase after the horizon", () => {
    for (const input of samples) {
      const horizon = lifecycleHorizon(input, now);
      expect(companyPhase(input, horizon)).toBe(companyPhase(input, plus(horizon, 3650)));
    }
  });

  it("finds the moment companyPhase itself moves, to the millisecond", () => {
    for (const input of samples) {
      for (const target of ["read_only", "locked"] as const) {
        const at = phaseReachedAt(input, now, target);
        const reachedAt = (date: Date) => PHASE_RANK[companyPhase(input, date)] <= PHASE_RANK[target];
        if (at === null) {
          expect(reachedAt(now) || !reachedAt(lifecycleHorizon(input, now))).toBe(true);
          continue;
        }
        expect(at.getTime()).toBeGreaterThan(now.getTime());
        expect(reachedAt(at)).toBe(true);
        expect(reachedAt(new Date(at.getTime() - 1))).toBe(false);
      }
    }
  });
});
