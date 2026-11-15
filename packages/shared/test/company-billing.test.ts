import { describe, expect, it } from "vitest";
import { companyPhase, type LifecycleFacts, type LifecycleSubscription } from "../src/permissions/company-lifecycle";
import {
  billingNoticeText,
  companyBillingView,
  ownerBillingNotice,
  SUBSCRIPTION_STANDING_TEXT,
  subscriptionStanding,
  type BillingRow,
} from "../src/platform/company-billing";
import type { OwnerBillingNotice, ReadOnlyReason, SubscriptionStanding } from "../src/types/platform";

const DAY = 86_400_000;
const now = new Date("2026-11-15T12:00:00Z");
const inDays = (days: number) => new Date(now.getTime() + days * DAY);
const plus = (date: Date, days: number) => new Date(date.getTime() + days * DAY);
const iso = (date: Date) => date.toISOString();

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

const notice = (input: LifecycleFacts, databaseReadOnly = false) =>
  ownerBillingNotice({ facts: input, databaseReadOnly, now });

describe("subscriptionStanding (platform-admin spec part 4, CompanyBillingSubscription)", () => {
  const cases: [string, string | Date, SubscriptionStanding][] = [
    ["trial", inDays(1), "trial"],
    ["trial", inDays(-1), "trial_ended"],
    ["trial", now, "trial_ended"],
    ["active", inDays(1), "current"],
    ["active", inDays(-1), "overdue"],
    ["active", now, "overdue"],
    ["past_due", inDays(1), "past_due"],
    ["past_due", inDays(-1), "overdue"],
    ["past_due", now, "overdue"],
    ["cancelled", inDays(1), "cancelled"],
    ["cancelled", inDays(-1), "cancelled"],
    ["cancelled", now, "cancelled"],
    ["paused", inDays(1), "unknown"],
    ["paused", inDays(-1), "unknown"],
    ["active", "not a date", "unknown"],
    ["trial", new Date(Number.NaN), "unknown"],
    ["cancelled", "not a date", "unknown"],
    ["active", iso(inDays(1)), "current"],
    ["active", iso(now), "overdue"],
  ];

  it.each(cases)("gives a %s row ending %s the standing %s", (status, currentPeriodEnd, standing) => {
    expect(subscriptionStanding({ status, currentPeriodEnd }, now)).toBe(standing);
  });
});

describe("ownerBillingNotice (spec part 4, The Owner's notice)", () => {
  it("gives a current plan no notice", () => {
    expect(notice(facts({ subscriptions: [row({ currentPeriodEnd: inDays(10) })] }))).toBeNull();
  });

  it("says a payment is overdue inside the 14-day grace, with the end and the read-only day", () => {
    const end = inDays(-3);
    expect(notice(facts({ subscriptions: [row({ currentPeriodEnd: end })] }))).toEqual({
      kind: "payment_overdue",
      since: iso(end),
      readOnlyFrom: iso(plus(end, 14)),
    });
  });

  it("gives no notice when another row keeps the company in full use past the grace", () => {
    const input = facts({
      subscriptions: [row({ currentPeriodEnd: inDays(-3) }), row({ currentPeriodEnd: inDays(30) })],
    });
    expect(notice(input)).toBeNull();
  });

  it("says a payment is overdue for a past-due row that hasn't ended, with no end date", () => {
    const end = inDays(10);
    expect(notice(facts({ subscriptions: [row({ status: "past_due", currentPeriodEnd: end })] }))).toEqual({
      kind: "payment_overdue",
      since: null,
      readOnlyFrom: iso(plus(end, 14)),
    });
  });

  it("says a payment is overdue for a past-due company with a current row", () => {
    const end = inDays(10);
    expect(notice(facts({ status: "past_due", subscriptions: [row({ currentPeriodEnd: end })] }))).toEqual({
      kind: "payment_overdue",
      since: null,
      readOnlyFrom: iso(plus(end, 14)),
    });
  });

  it("says the plan lapsed once the grace is over, with the day it locks", () => {
    const end = inDays(-20);
    expect(notice(facts({ subscriptions: [row({ currentPeriodEnd: end })] }))).toEqual({
      kind: "read_only",
      reason: "payment_lapsed",
      since: iso(end),
      lockedFrom: iso(plus(end, 44)),
    });
  });

  it("says the trial ended", () => {
    const end = inDays(-5);
    const input = facts({
      status: "trial",
      subscriptions: [row({ status: "trial", price: "0", currentPeriodEnd: end })],
    });
    expect(notice(input)).toEqual({
      kind: "read_only",
      reason: "trial_ended",
      since: iso(end),
      lockedFrom: iso(plus(end, 30)),
    });
  });

  it("says a company suspended after paying is suspended, locking on its row's ladder", () => {
    const end = inDays(20);
    const input = facts({
      status: "suspended",
      statusChangedAt: inDays(-5),
      subscriptions: [row({ currentPeriodEnd: end })],
    });
    expect(notice(input)).toEqual({
      kind: "read_only",
      reason: "suspended",
      since: null,
      lockedFrom: iso(plus(end, 44)),
    });
  });

  it("says a company suspended before paying is suspended, locking 30 days after the change", () => {
    const since = inDays(-5);
    expect(notice(facts({ status: "suspended", statusChangedAt: since }))).toEqual({
      kind: "read_only",
      reason: "suspended",
      since: null,
      lockedFrom: iso(plus(since, 30)),
    });
  });

  it("says a cancelled company is cancelled, with the day it locks", () => {
    const since5 = inDays(-5);
    const since10 = inDays(-10);
    const cases: [LifecycleFacts, Date][] = [
      [facts({ status: "cancelled", statusChangedAt: since5 }), plus(since5, 30)],
      [
        facts({
          status: "cancelled",
          statusChangedAt: since10,
          subscriptions: [row({ currentPeriodEnd: inDays(20) })],
        }),
        inDays(64),
      ],
      [
        facts({
          status: "cancelled",
          statusChangedAt: since10,
          subscriptions: [row({ currentPeriodEnd: inDays(300) })],
        }),
        plus(since10, 90),
      ],
    ];
    for (const [input, lockedFrom] of cases) {
      expect(notice(input)).toEqual({
        kind: "read_only",
        reason: "cancelled",
        since: null,
        lockedFrom: iso(lockedFrom),
      });
    }
  });

  it("says a counted cancelled row is cancelled, locking 90 days after its paid end", () => {
    const end = inDays(-5);
    const input = facts({ subscriptions: [row({ status: "cancelled", price: "10.00", currentPeriodEnd: end })] });
    expect(notice(input)).toEqual({
      kind: "read_only",
      reason: "cancelled",
      since: null,
      lockedFrom: iso(plus(end, 90)),
    });
  });

  it("explains a read-only database in full use, even while a payment is overdue", () => {
    const expected = { kind: "read_only", reason: "database", since: null, lockedFrom: null };
    expect(notice(facts({ subscriptions: [row({ currentPeriodEnd: inDays(10) })] }), true)).toEqual(expected);
    expect(notice(facts({ subscriptions: [row({ currentPeriodEnd: inDays(-3) })] }), true)).toEqual(expected);
  });

  it("gives a locked company no notice", () => {
    expect(notice(facts({ subscriptions: [row({ currentPeriodEnd: inDays(-60) })] }))).toBeNull();
    expect(notice(facts({ status: "suspended", statusChangedAt: inDays(-40) }), true)).toBeNull();
  });

  it("explains a lapsed plan from the rows a deleted row can't hide", () => {
    const end = inDays(-20);
    expect(notice(facts({ subscriptions: [row({ currentPeriodEnd: end, deleted: true })] }))).toEqual({
      kind: "read_only",
      reason: "payment_lapsed",
      since: iso(end),
      lockedFrom: iso(plus(end, 44)),
    });
  });
});

describe("companyBillingView (spec part 4, The answer)", () => {
  const billingRow = (overrides: Partial<BillingRow>): BillingRow => ({
    planName: "Flooring Pro",
    product: "flooring",
    interval: "monthly",
    currentPeriodStart: inDays(-20),
    currentPeriodEnd: inDays(10),
    status: "active",
    deleted: false,
    ...overrides,
  });
  const input = facts({
    subscriptions: [
      row({ price: "12345.67", currentPeriodEnd: inDays(-100), deleted: true }),
      row({ price: "12345.67", currentPeriodEnd: inDays(10) }),
      row({ status: "trial", price: "0", currentPeriodEnd: inDays(3) }),
    ],
  });
  const rows = [
    billingRow({ planName: "Old plan", currentPeriodEnd: inDays(-100), deleted: true }),
    billingRow({}),
    billingRow({
      planName: "HR Trial",
      product: "hr",
      interval: "yearly",
      status: "trial",
      currentPeriodEnd: inDays(3),
    }),
  ];
  const view = companyBillingView({
    facts: input,
    databaseReadOnly: false,
    rows,
    limits: { userLimit: 16, branchLimit: null },
    now,
  });

  it("has exactly the fields of CompanyBilling and CompanyBillingSubscription", () => {
    expect(Object.keys(view).sort()).toEqual(["limits", "notice", "phase", "status", "subscriptions"]);
    expect(Object.keys(view.limits).sort()).toEqual(["branchLimit", "userLimit"]);
    for (const subscription of view.subscriptions) {
      expect(Object.keys(subscription).sort()).toEqual([
        "currentPeriodEnd",
        "currentPeriodStart",
        "interval",
        "planName",
        "product",
        "standing",
      ]);
    }
  });

  it("never holds a price", () => {
    expect(JSON.stringify(view)).not.toContain("12345.67");
    expect(JSON.stringify(view)).not.toMatch(/price/i);
  });

  it("leaves deleted rows out and keeps the order", () => {
    expect(view.subscriptions.map((subscription) => subscription.planName)).toEqual(["Flooring Pro", "HR Trial"]);
    expect(view.subscriptions).toEqual([
      {
        planName: "Flooring Pro",
        product: "flooring",
        interval: "monthly",
        currentPeriodStart: iso(inDays(-20)),
        currentPeriodEnd: iso(inDays(10)),
        standing: "current",
      },
      {
        planName: "HR Trial",
        product: "hr",
        interval: "yearly",
        currentPeriodStart: iso(inDays(-20)),
        currentPeriodEnd: iso(inDays(3)),
        standing: "trial",
      },
    ]);
  });

  it("gives the stored status, the life-cycle phase, the limits and the notice", () => {
    expect(view.status).toBe("active");
    expect(view.phase).toBe(companyPhase(input, now));
    expect(view.limits).toEqual({ userLimit: 16, branchLimit: null });
    expect(view.notice).toBeNull();
  });

  it("copies only the two limits", () => {
    const limits = { userLimit: 3, branchLimit: 1, extra: "x" } as { userLimit: number; branchLimit: number };
    const other = companyBillingView({ facts: input, databaseReadOnly: false, rows, limits, now });
    expect(other.limits).toEqual({ userLimit: 3, branchLimit: 1 });
  });

  it("gives a fresh trial no rows and a read-only phase its notice", () => {
    const trial = companyBillingView({
      facts: facts({ status: "trial" }),
      databaseReadOnly: false,
      rows: [],
      limits: { userLimit: null, branchLimit: null },
      now,
    });
    expect(trial).toEqual({
      status: "trial",
      phase: "full",
      subscriptions: [],
      limits: { userLimit: null, branchLimit: null },
      notice: null,
    });
    const end = inDays(-20);
    const lapsed = companyBillingView({
      facts: facts({ subscriptions: [row({ currentPeriodEnd: end })] }),
      databaseReadOnly: false,
      rows: [billingRow({ currentPeriodEnd: end })],
      limits: { userLimit: 5, branchLimit: 1 },
      now,
    });
    expect(lapsed.phase).toBe("read_only");
    expect(lapsed.subscriptions[0]?.standing).toBe("overdue");
    expect(lapsed.notice?.kind).toBe("read_only");
  });
});

describe("billingNoticeText (spec part 4, The Owner's banner: Copy)", () => {
  const formatDate = (value: string) => `<${value.slice(0, 10)}>`;
  const since = "2026-11-01T00:00:00.000Z";
  const lockedFrom = "2026-12-15T00:00:00.000Z";
  const readOnly = (reason: ReadOnlyReason, dates: { since?: string | null; lockedFrom?: string | null } = {}) =>
    billingNoticeText(
      { kind: "read_only", reason, since: dates.since ?? null, lockedFrom: dates.lockedFrom ?? null },
      formatDate,
    );

  it("words an overdue payment with and without its dates", () => {
    const full: OwnerBillingNotice = { kind: "payment_overdue", since, readOnlyFrom: "2026-11-15T00:00:00.000Z" };
    expect(billingNoticeText(full, formatDate)).toEqual({
      tone: "warning",
      title: "Payment overdue",
      body: "Your plan's period ended on <2026-11-01>. Your company's account becomes read only on <2026-11-15> unless it is renewed. Contact us to renew.",
      linksToBilling: true,
    });
    expect(billingNoticeText({ kind: "payment_overdue", since: null, readOnlyFrom: null }, formatDate).body).toBe(
      "A payment for your plan is overdue. Contact us to renew.",
    );
  });

  it("words a suspended and a cancelled account, with and without the lock", () => {
    expect(readOnly("suspended", { lockedFrom })).toEqual({
      tone: "danger",
      title: "Account suspended: read only",
      body: "You and your team can view and export, but not make changes. It locks on <2026-12-15>. Contact us to restore access.",
      linksToBilling: true,
    });
    expect(readOnly("suspended").body).toBe(
      "You and your team can view and export, but not make changes. Contact us to restore access.",
    );
    expect(readOnly("cancelled", { lockedFrom })).toEqual({
      tone: "danger",
      title: "Account cancelled: read only",
      body: "You and your team can view and export, but not make changes. It locks on <2026-12-15>. Contact us to reopen it.",
      linksToBilling: true,
    });
    expect(readOnly("cancelled").body).toBe(
      "You and your team can view and export, but not make changes. Contact us to reopen it.",
    );
  });

  it("words a lapsed plan and an ended trial, with and without their dates", () => {
    expect(readOnly("payment_lapsed", { since, lockedFrom })).toEqual({
      tone: "danger",
      title: "Plan ended: read only",
      body: "Your plan's period ended on <2026-11-01>, so your company's account is read only. It locks on <2026-12-15>. Contact us to renew.",
      linksToBilling: true,
    });
    expect(readOnly("payment_lapsed").body).toBe(
      "Your plan's period has ended, so your company's account is read only. Contact us to renew.",
    );
    expect(readOnly("trial_ended", { since, lockedFrom })).toEqual({
      tone: "danger",
      title: "Trial ended: read only",
      body: "Your trial ended on <2026-11-01>, so your company's account is read only. It locks on <2026-12-15>. Contact us to choose a plan.",
      linksToBilling: true,
    });
    expect(readOnly("trial_ended").body).toBe(
      "Your trial has ended, so your company's account is read only. Contact us to choose a plan.",
    );
  });

  it("words a read-only database with no link, and any other read-only account plainly", () => {
    expect(readOnly("database")).toEqual({
      tone: "warning",
      title: "Read only for now",
      body: "Your company's data is read only while we work on its database. Changes can't be saved yet.",
      linksToBilling: false,
    });
    const account = {
      tone: "danger",
      title: "Read only",
      body: "Your company's account is read only right now, so changes can't be saved. Contact us if this is unexpected.",
      linksToBilling: true,
    };
    expect(readOnly("account")).toEqual(account);
    expect(readOnly("something new" as ReadOnlyReason)).toEqual(account);
  });

  it("never promises the account stays read only", () => {
    const reasons: ReadOnlyReason[] = [
      "suspended",
      "cancelled",
      "payment_lapsed",
      "trial_ended",
      "database",
      "account",
    ];
    const bodies = [
      ...reasons.flatMap((reason) => [readOnly(reason).body, readOnly(reason, { since, lockedFrom }).body]),
      billingNoticeText({ kind: "payment_overdue", since, readOnlyFrom: lockedFrom }, formatDate).body,
    ];
    for (const body of bodies) {
      expect(body).not.toContain("until we restore");
      expect(body).not.toMatch(/stays read only/);
    }
  });
});

describe("SUBSCRIPTION_STANDING_TEXT", () => {
  it("words each standing", () => {
    const end = "Dec 1, 2026";
    expect(
      Object.fromEntries(Object.entries(SUBSCRIPTION_STANDING_TEXT).map(([key, text]) => [key, text(end)])),
    ).toEqual({
      current: "Current period ends Dec 1, 2026",
      past_due: "Payment overdue; period ends Dec 1, 2026",
      overdue: "Period ended Dec 1, 2026",
      trial: "Trial ends Dec 1, 2026",
      trial_ended: "Trial ended Dec 1, 2026",
      cancelled: "Cancelled",
      unknown: "Status unknown",
    });
  });
});
