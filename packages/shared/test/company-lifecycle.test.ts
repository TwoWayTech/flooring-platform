import { describe, expect, it } from "vitest";
import { companyPhase, type LifecycleFacts, type LifecycleSubscription } from "../src/permissions/company-lifecycle";

const DAY = 86_400_000;
const now = new Date("2026-11-13T12:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

const sub = (overrides: Partial<LifecycleSubscription>): LifecycleSubscription => ({
  status: "active",
  currentPeriodEnd: daysAgo(0),
  price: "99.00",
  deleted: false,
  ...overrides,
});

const facts = (overrides: Partial<LifecycleFacts>): LifecycleFacts => ({
  status: "active",
  statusChangedAt: daysAgo(400),
  subscriptions: [],
  ...overrides,
});

describe("companyPhase (owner decisions 2026-11-13)", () => {
  it("keeps a fresh trial with no subscription full", () => {
    expect(companyPhase(facts({ status: "trial" }), now)).toBe("full");
  });

  it("gives a lapsed paid plan 14 days full, 30 days read-only, then locks it", () => {
    const at = (days: number) =>
      companyPhase(facts({ subscriptions: [sub({ currentPeriodEnd: daysAgo(days) })] }), now);
    expect(at(-5)).toBe("full");
    expect(at(13.9)).toBe("full");
    expect(at(14)).toBe("read_only");
    expect(at(43.9)).toBe("read_only");
    expect(at(44)).toBe("locked");
    expect(
      companyPhase(facts({ subscriptions: [sub({ status: "past_due", currentPeriodEnd: daysAgo(20) })] }), now),
    ).toBe("read_only");
  });

  it("makes a trial that ended unpaid read-only for 30 days, then locks it", () => {
    const at = (days: number) =>
      companyPhase(
        facts({
          status: "trial",
          subscriptions: [sub({ status: "trial", price: "0", currentPeriodEnd: daysAgo(days) })],
        }),
        now,
      );
    expect(at(-1)).toBe("full");
    expect(at(1)).toBe("read_only");
    expect(at(29.9)).toBe("read_only");
    expect(at(30)).toBe("locked");
  });

  it("makes a trial suspended or cancelled before paying read-only for 30 days, then locks it", () => {
    for (const status of ["suspended", "cancelled"] as const) {
      expect(companyPhase(facts({ status, statusChangedAt: daysAgo(10) }), now)).toBe("read_only");
      expect(companyPhase(facts({ status, statusChangedAt: daysAgo(30) }), now)).toBe("locked");
      const trialRow = sub({ status: "cancelled", price: "0.00", currentPeriodEnd: daysAgo(40) });
      expect(companyPhase(facts({ status, statusChangedAt: daysAgo(31), subscriptions: [trialRow] }), now)).toBe(
        "locked",
      );
    }
  });

  it("keeps a company that paid and cancelled read-only for 90 days (blueprint p29)", () => {
    const paid = sub({ status: "cancelled", currentPeriodEnd: daysAgo(5) });
    expect(companyPhase(facts({ status: "cancelled", statusChangedAt: daysAgo(89), subscriptions: [paid] }), now)).toBe(
      "read_only",
    );
    expect(companyPhase(facts({ status: "cancelled", statusChangedAt: daysAgo(90), subscriptions: [paid] }), now)).toBe(
      "locked",
    );
  });

  it("keeps a suspended company that paid read-only until an admin acts, but never longer than its plan allows", () => {
    const current = sub({ currentPeriodEnd: daysAgo(-20) });
    expect(
      companyPhase(facts({ status: "suspended", statusChangedAt: daysAgo(300), subscriptions: [current] }), now),
    ).toBe("read_only");
    const lapsed = sub({ currentPeriodEnd: daysAgo(60) });
    expect(companyPhase(facts({ status: "suspended", subscriptions: [lapsed] }), now)).toBe("locked");
  });

  it("counts the most generous live subscription, and a deleted one only as proof of payment", () => {
    const current = sub({ currentPeriodEnd: daysAgo(-10) });
    const old = sub({ currentPeriodEnd: daysAgo(100) });
    expect(companyPhase(facts({ subscriptions: [old, current] }), now)).toBe("full");
    expect(companyPhase(facts({ subscriptions: [{ ...current, deleted: true }] }), now)).toBe("full");
    const deletedPaid = sub({ deleted: true });
    expect(
      companyPhase(facts({ status: "cancelled", statusChangedAt: daysAgo(60), subscriptions: [deletedPaid] }), now),
    ).toBe("read_only");
  });
});
