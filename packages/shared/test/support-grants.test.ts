import { describe, expect, it } from "vitest";
import {
  inSupportWindow,
  isOpenSupportGrant,
  SUPPORT_HOURS,
  SUPPORT_HOURS_MESSAGE,
  SUPPORT_LIMIT_MESSAGE,
  SUPPORT_OPEN_MESSAGE,
  SUPPORT_REASON,
  SUPPORT_REASON_MESSAGE,
  SUPPORT_REQUEST_LIMIT,
  SUPPORT_CLOSED_MESSAGES,
  SUPPORT_OWNER_ONLY_MESSAGE,
  SUPPORT_READ_ONLY_MESSAGE,
  supportActions,
  supportGrantDecisionRefusal,
  supportGrantExpiresAt,
  supportGrantStatus,
  supportRequestFacts,
  supportRequestInputProblem,
  supportRequestRefusal,
  supportWindowStart,
  type SupportGrantDates,
  type SupportGrantFactRow,
} from "../src/platform/support-grants";
import type { SupportGrantStatus } from "../src/types/platform";

const NOW = new Date("2026-11-15T10:00:00.000Z");
const HOUR = 3_600_000;
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);
const iso = (offsetMs: number) => at(offsetMs).toISOString();

describe("supportGrantStatus (platform-admin spec, Support requests: Status)", () => {
  it("is pending until approved, then approved, while it hasn't expired", () => {
    expect(supportGrantStatus({ approvedAt: null, revokedAt: null, expiresAt: at(HOUR) }, NOW)).toBe("pending");
    expect(supportGrantStatus({ approvedAt: at(-HOUR), revokedAt: null, expiresAt: at(HOUR) }, NOW)).toBe("approved");
  });

  it("is expired at or after its end, approved or not", () => {
    expect(supportGrantStatus({ approvedAt: null, revokedAt: null, expiresAt: NOW }, NOW)).toBe("expired");
    expect(supportGrantStatus({ approvedAt: at(-2 * HOUR), revokedAt: null, expiresAt: at(-1) }, NOW)).toBe("expired");
    expect(supportGrantStatus({ approvedAt: null, revokedAt: null, expiresAt: at(1) }, NOW)).toBe("pending");
  });

  it("is revoked whenever it was revoked, expired or approved included", () => {
    for (const approvedAt of [null, at(-HOUR)]) {
      for (const expiresAt of [at(HOUR), at(-HOUR), NOW]) {
        expect(supportGrantStatus({ approvedAt, revokedAt: at(-1), expiresAt }, NOW)).toBe("revoked");
      }
    }
  });

  it("reads ISO strings as the demo stores them", () => {
    expect(supportGrantStatus({ approvedAt: iso(-HOUR), revokedAt: null, expiresAt: iso(HOUR) }, NOW)).toBe("approved");
    expect(supportGrantStatus({ approvedAt: null, revokedAt: iso(-1), expiresAt: iso(HOUR) }, NOW)).toBe("revoked");
    expect(supportGrantStatus({ approvedAt: null, revokedAt: null, expiresAt: iso(0) }, NOW)).toBe("expired");
  });

  it("treats an end that can't be read as expired (deny by default)", () => {
    expect(supportGrantStatus({ approvedAt: iso(-HOUR), revokedAt: null, expiresAt: "not a date" }, NOW)).toBe(
      "expired",
    );
    expect(supportGrantStatus({ approvedAt: null, revokedAt: null, expiresAt: new Date(Number.NaN) }, NOW)).toBe(
      "expired",
    );
  });
});

describe("isOpenSupportGrant (platform-admin spec, Support requests: Open)", () => {
  it("is open while pending or approved and not expired", () => {
    expect(isOpenSupportGrant({ revokedAt: null, expiresAt: at(HOUR) }, NOW)).toBe(true);
    expect(isOpenSupportGrant({ revokedAt: null, expiresAt: at(HOUR), deletedAt: null }, NOW)).toBe(true);
    expect(isOpenSupportGrant({ revokedAt: null, expiresAt: iso(1) }, NOW)).toBe(true);
  });

  it("is closed once expired, revoked or deleted", () => {
    expect(isOpenSupportGrant({ revokedAt: null, expiresAt: NOW }, NOW)).toBe(false);
    expect(isOpenSupportGrant({ revokedAt: null, expiresAt: at(-HOUR) }, NOW)).toBe(false);
    expect(isOpenSupportGrant({ revokedAt: at(-1), expiresAt: at(HOUR) }, NOW)).toBe(false);
    expect(isOpenSupportGrant({ revokedAt: null, expiresAt: at(HOUR), deletedAt: at(-1) }, NOW)).toBe(false);
    expect(isOpenSupportGrant({ revokedAt: null, expiresAt: "not a date" }, NOW)).toBe(false);
  });
});

describe("the 24-hour window (platform-admin spec, The limits)", () => {
  it("starts 24 hours before now", () => {
    expect(SUPPORT_REQUEST_LIMIT).toEqual({ perWindow: 10, windowMs: 24 * HOUR });
    expect(supportWindowStart(NOW).toISOString()).toBe("2026-11-14T10:00:00.000Z");
  });

  it("counts a grant created after the start and not one created at or before it", () => {
    expect(inSupportWindow(at(-24 * HOUR + 1), NOW)).toBe(true);
    expect(inSupportWindow(at(-24 * HOUR), NOW)).toBe(false);
    expect(inSupportWindow(at(-24 * HOUR - 1), NOW)).toBe(false);
    expect(inSupportWindow(iso(-HOUR), NOW)).toBe(true);
  });

  it("counts a grant stamped after now and a time that can't be read (deny by default)", () => {
    expect(inSupportWindow(at(HOUR), NOW)).toBe(true);
    expect(inSupportWindow("not a date", NOW)).toBe(true);
  });

  it("ends a grant the asked hours after now", () => {
    expect(supportGrantExpiresAt(NOW, 2).toISOString()).toBe("2026-11-15T12:00:00.000Z");
    expect(supportGrantExpiresAt(NOW, SUPPORT_HOURS.max).toISOString()).toBe("2026-11-18T10:00:00.000Z");
  });
});

describe("supportRequestInputProblem (platform-admin spec, POST /platform/support-grants: Body)", () => {
  it("words its refusals as the spec does", () => {
    expect(SUPPORT_REASON).toEqual({ min: 10, max: 500 });
    expect(SUPPORT_HOURS).toEqual({ min: 1, max: 72 });
    expect(SUPPORT_REASON_MESSAGE).toBe("Give a reason of 10 to 500 characters.");
    expect(SUPPORT_HOURS_MESSAGE).toBe("Enter a whole number of hours from 1 to 72.");
  });

  it("accepts a reason of 10 to 500 characters and refuses 9 or 501", () => {
    expect(supportRequestInputProblem({ reason: "r".repeat(9), hours: 4 })).toBe(SUPPORT_REASON_MESSAGE);
    expect(supportRequestInputProblem({ reason: "r".repeat(10), hours: 4 })).toBeNull();
    expect(supportRequestInputProblem({ reason: "r".repeat(500), hours: 4 })).toBeNull();
    expect(supportRequestInputProblem({ reason: "r".repeat(501), hours: 4 })).toBe(SUPPORT_REASON_MESSAGE);
  });

  it("counts the reason after trimming", () => {
    expect(supportRequestInputProblem({ reason: `   ${"r".repeat(9)}   `, hours: 4 })).toBe(SUPPORT_REASON_MESSAGE);
    expect(supportRequestInputProblem({ reason: ` ${"r".repeat(10)}\n`, hours: 4 })).toBeNull();
    expect(supportRequestInputProblem({ reason: ` ${"r".repeat(500)} `, hours: 4 })).toBeNull();
    expect(supportRequestInputProblem({ reason: " ".repeat(20), hours: 4 })).toBe(SUPPORT_REASON_MESSAGE);
  });

  it("accepts whole hours from 1 to 72 and refuses anything else", () => {
    const reason = "Checking the roles";
    for (const hours of [1, 4, 72]) expect(supportRequestInputProblem({ reason, hours })).toBeNull();
    for (const hours of [0, 73, 1.5, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(supportRequestInputProblem({ reason, hours })).toBe(SUPPORT_HOURS_MESSAGE);
    }
  });

  it("checks the reason before the hours, and refuses fields of the wrong type", () => {
    expect(supportRequestInputProblem({ reason: "short", hours: 0 })).toBe(SUPPORT_REASON_MESSAGE);
    const textHours = JSON.parse('{"reason": "Checking the roles", "hours": "4"}');
    const noReason = JSON.parse('{"reason": null, "hours": 4}');
    expect(supportRequestInputProblem(textHours)).toBe(SUPPORT_HOURS_MESSAGE);
    expect(supportRequestInputProblem(noReason)).toBe(SUPPORT_REASON_MESSAGE);
  });
});

describe("supportRequestRefusal (platform-admin spec, The limits)", () => {
  const open = { status: 409, code: "grant_open", message: SUPPORT_OPEN_MESSAGE };
  const limited = { status: 429, code: "rate_limited", message: SUPPORT_LIMIT_MESSAGE };

  it("words its refusals as the spec does", () => {
    expect(SUPPORT_OPEN_MESSAGE).toBe("You already have an open support request for this company.");
    expect(SUPPORT_LIMIT_MESSAGE).toBe("You can send at most 10 support requests in 24 hours. Try again later.");
  });

  it("refuses an open grant for the company with 409", () => {
    expect(supportRequestRefusal({ openForCompany: true, requestsInWindow: 0 })).toEqual(open);
  });

  it("refuses the 11th request in the window with 429 and lets the 10th through", () => {
    expect(supportRequestRefusal({ openForCompany: false, requestsInWindow: 9 })).toBeNull();
    expect(supportRequestRefusal({ openForCompany: false, requestsInWindow: 10 })).toEqual(limited);
    expect(supportRequestRefusal({ openForCompany: false, requestsInWindow: 25 })).toEqual(limited);
  });

  it("checks the open grant before the window", () => {
    expect(supportRequestRefusal({ openForCompany: true, requestsInWindow: 10 })).toEqual(open);
  });

  it("refuses a count that is not a number (deny by default)", () => {
    expect(supportRequestRefusal({ openForCompany: false, requestsInWindow: Number.NaN })).toEqual(limited);
  });
});

describe("supportRequestFacts (platform-admin spec, What a request does: step 4)", () => {
  const COMPANY = "company-x";
  const OTHER = "company-y";
  function grant(overrides: Partial<SupportGrantFactRow>): SupportGrantFactRow {
    return {
      companyId: COMPANY,
      createdAt: at(-HOUR),
      revokedAt: null,
      expiresAt: at(HOUR),
      deletedAt: null,
      ...overrides,
    };
  }

  it("finds an open grant for this company only", () => {
    expect(supportRequestFacts([grant({})], COMPANY, NOW).openForCompany).toBe(true);
    expect(supportRequestFacts([grant({ companyId: OTHER })], COMPANY, NOW).openForCompany).toBe(false);
    expect(supportRequestFacts([grant({ revokedAt: at(-1) })], COMPANY, NOW).openForCompany).toBe(false);
    expect(supportRequestFacts([grant({ expiresAt: NOW })], COMPANY, NOW).openForCompany).toBe(false);
    expect(supportRequestFacts([grant({ deletedAt: at(-1) })], COMPANY, NOW).openForCompany).toBe(false);
  });

  it("counts every grant in the window across companies, revoked, expired and deleted ones too", () => {
    const grants = [
      grant({}),
      grant({ companyId: OTHER }),
      grant({ revokedAt: at(-1) }),
      grant({ expiresAt: at(-1) }),
      grant({ deletedAt: at(-1) }),
      grant({ createdAt: at(-24 * HOUR - 60_000) }),
    ];
    expect(supportRequestFacts(grants, COMPANY, NOW)).toEqual({ openForCompany: true, requestsInWindow: 5 });
  });

  it("gives a 429 after nine old revoked grants and a tenth for another company", () => {
    const grants = [
      ...Array.from({ length: 9 }, () => grant({ companyId: OTHER, revokedAt: at(-1) })),
      grant({ companyId: "company-z" }),
      grant({ createdAt: at(-24 * HOUR - 60_000), expiresAt: at(-20 * HOUR) }),
    ];
    const facts = supportRequestFacts(grants, COMPANY, NOW);
    expect(facts).toEqual({ openForCompany: false, requestsInWindow: 10 });
    expect(supportRequestRefusal(facts)?.status).toBe(429);
  });

  it("gives no facts against a first request", () => {
    expect(supportRequestFacts([], COMPANY, NOW)).toEqual({ openForCompany: false, requestsInWindow: 0 });
  });
});

describe("supportGrantDecisionRefusal (platform-admin spec part 4, The support-access routes)", () => {
  const grants: Record<SupportGrantStatus, SupportGrantDates> = {
    pending: { approvedAt: null, revokedAt: null, expiresAt: at(HOUR) },
    approved: { approvedAt: at(-HOUR), revokedAt: null, expiresAt: at(HOUR) },
    revoked: { approvedAt: at(-HOUR), revokedAt: at(-1), expiresAt: at(HOUR) },
    expired: { approvedAt: null, revokedAt: null, expiresAt: at(-1) },
  };

  it("lets the Owner approve only a pending grant", () => {
    expect(supportGrantDecisionRefusal(grants.pending, "approve", NOW)).toBeNull();
    for (const status of ["approved", "revoked", "expired"] as const) {
      expect(supportGrantDecisionRefusal(grants[status], "approve", NOW), status).toBe("grant_closed");
    }
  });

  it("lets the Owner revoke a pending or approved grant", () => {
    expect(supportGrantDecisionRefusal(grants.pending, "revoke", NOW)).toBeNull();
    expect(supportGrantDecisionRefusal(grants.approved, "revoke", NOW)).toBeNull();
    for (const status of ["revoked", "expired"] as const) {
      expect(supportGrantDecisionRefusal(grants[status], "revoke", NOW), status).toBe("grant_closed");
    }
  });

  it("refuses both at an expiry equal to now, and for an expiry that can't be read", () => {
    for (const step of ["approve", "revoke"] as const) {
      expect(supportGrantDecisionRefusal({ approvedAt: null, revokedAt: null, expiresAt: NOW }, step, NOW)).toBe(
        "grant_closed",
      );
      expect(supportGrantDecisionRefusal({ approvedAt: null, revokedAt: null, expiresAt: iso(0) }, step, NOW)).toBe(
        "grant_closed",
      );
      expect(
        supportGrantDecisionRefusal({ approvedAt: null, revokedAt: null, expiresAt: "not a date" }, step, NOW),
      ).toBe("grant_closed");
    }
  });
});

describe("supportActions (platform-admin spec part 4, the Owner's panel)", () => {
  it("offers approve and revoke while pending, revoke while approved, nothing once ended", () => {
    expect(supportActions("pending", false)).toEqual(["approve", "revoke"]);
    expect(supportActions("approved", false)).toEqual(["revoke"]);
    expect(supportActions("revoked", false)).toEqual([]);
    expect(supportActions("expired", false)).toEqual([]);
  });

  it("offers nothing while the company is read only", () => {
    for (const status of ["pending", "approved", "revoked", "expired"] as const) {
      expect(supportActions(status, true), status).toEqual([]);
    }
  });
});

describe("the Owner's support messages", () => {
  it("are the API's words", () => {
    expect(SUPPORT_OWNER_ONLY_MESSAGE).toBe("Only an Owner can manage support access.");
    expect(SUPPORT_CLOSED_MESSAGES).toEqual({
      approve: "This request is no longer waiting for approval.",
      revoke: "This access has already ended.",
    });
    expect(SUPPORT_READ_ONLY_MESSAGE).toBe(
      "Support access can't be changed while your company's account is read only. Requests end on their own at the time shown.",
    );
  });
});
