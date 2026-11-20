import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { CompanyAnswer } from "@workspace/shared";
import { CompanyDay, browserDay, companyDayOf } from "@/lib/api/company-day";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";
import { fakeApi } from "./fake-api";

/**
 * The company's day on the web (ADR 0051, "The company's day on the web", 2026-11-20): `today()` is the
 * day in the company's zone, worked out on every call, wherever the browser is. Summit is in Denver.
 * The clock is faked around midnight in Denver while the process (the "browser") runs in Tokyo or UTC.
 */

/** 23:30 on November 20th in Denver (MST, UTC-7): already the 21st in UTC (06:30) and in Tokyo (15:30). */
const DENVER_EVENING = new Date("2026-11-21T06:30:00Z");
/** 00:30 on November 21st in Denver, an hour later. */
const DENVER_AFTER_MIDNIGHT = new Date("2026-11-21T07:30:00Z");
/** 08:00 on November 20th in Tokyo (UTC+9): still the 19th in UTC (23:00) and in Denver (16:00). */
const TOKYO_MORNING = new Date("2026-11-19T23:00:00Z");

const zoneBefore = process.env.TZ;

/** Runs the tests of a block with the process (the browser's clock) in a zone. */
function inBrowserZone(zone: string) {
  beforeAll(() => {
    process.env.TZ = zone;
  });
  afterAll(() => {
    if (zoneBefore === undefined) delete process.env.TZ;
    else process.env.TZ = zoneBefore;
  });
}

/** Freezes the clock at a moment; the timers keep running so the demo's dynamic imports resolve. */
function at(moment: Date) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(moment);
}

afterEach(() => {
  vi.useRealTimers();
});

/** A GET /company answer with only what the day reads filled in. */
function companyAnswer(timeZone: string): CompanyAnswer {
  return {
    company: {
      id: "0195f3a2-7b1c-7d4e-8f00-0000000000c1",
      slug: "summit",
      name: "Summit Floor Co.",
      city: "Denver",
      state: "CO",
      timeZone,
      modules: ["platform", "core"],
      ceiling: null,
      branches: [],
    },
    me: {
      id: "0195f3a2-7b1c-7d4e-8f00-0000000000a3",
      companyId: "0195f3a2-7b1c-7d4e-8f00-0000000000c1" as CompanyAnswer["me"]["companyId"],
      name: "Priya Natarajan",
      email: "priya@example.test",
      title: "",
      roleIds: [],
      branchId: "",
      status: "active",
      mfaEnrolled: false,
      lastLoginAt: null,
      employeeId: null,
      defaultLocationId: null,
    },
    roles: [],
    access: { permissions: [], dataScope: "own", isOwner: false },
    people: [],
  };
}

const served = (timeZone: string) => ({ "GET /company": { status: 200, body: companyAnswer(timeZone) } });

/** No proof files in these tests. */
const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

describe("CompanyDay, with the browser in Tokyo", () => {
  inBrowserZone("Asia/Tokyo");

  it("CD1 is the browser's day until the company's zone is known", () => {
    at(DENVER_EVENING);
    expect(browserDay()).toBe("2026-11-21");
    expect(new CompanyDay().today()).toBe("2026-11-21");
  });

  it("CD2 is Denver's day once learned, and rolls over at Denver's midnight, not Tokyo's", () => {
    const day = new CompanyDay();
    day.learn("America/Denver");
    at(DENVER_EVENING);
    expect(day.today()).toBe("2026-11-20");
    vi.setSystemTime(DENVER_AFTER_MIDNIGHT);
    expect(day.today()).toBe("2026-11-21");
  });

  it("CD3 is Denver's yesterday in Tokyo's morning, so a default date is never the company's tomorrow either way", () => {
    const day = new CompanyDay();
    day.learn("America/Denver");
    at(TOKYO_MORNING);
    expect(browserDay()).toBe("2026-11-20");
    expect(day.today()).toBe("2026-11-19");
  });

  it("CD4 never learns a zone Intl doesn't know, and drops an earlier company's zone for it", () => {
    const day = new CompanyDay();
    at(DENVER_EVENING);
    day.learn("Mars/Olympus_Mons");
    day.learn("");
    expect(day.today()).toBe("2026-11-21");
    day.learn("America/Denver");
    expect(day.today()).toBe("2026-11-20");
    // Another company's answer with a zone this browser doesn't know: the browser's day, never Denver's.
    day.learn("Mars/Olympus_Mons");
    expect(day.today()).toBe("2026-11-21");
  });

  it("CD6 forgets the zone when the company closes", () => {
    const day = new CompanyDay();
    day.learn("America/Denver");
    at(DENVER_EVENING);
    day.forget();
    expect(day.today()).toBe("2026-11-21");
  });

  it("CD5 keeps one day per client: two clients never share a zone", () => {
    const first = {};
    const second = {};
    companyDayOf(first).learn("America/Denver");
    companyDayOf(second).learn("Pacific/Honolulu");
    expect(companyDayOf(first)).toBe(companyDayOf(first));
    at(DENVER_AFTER_MIDNIGHT);
    expect(companyDayOf(first).today()).toBe("2026-11-21");
    expect(companyDayOf(second).today()).toBe("2026-11-20");
  });
});

describe("the api-mode client's today()", () => {
  describe("with the browser in Tokyo", () => {
    inBrowserZone("Asia/Tokyo");

    it("AD1 is the browser's day before GET /company, then the company's after getWorkspace(), with no request of its own", async () => {
      const fake = fakeApi(served("America/Denver"));
      at(DENVER_EVENING);
      expect(fake.client.today()).toBe("2026-11-21");
      await fake.client.getWorkspace();
      expect(fake.client.today()).toBe("2026-11-20");
      expect(fake.calls()).toEqual(["GET /company"]);
    });

    it("AD2 rolls over at the company's midnight in a tab left open, with no new read", async () => {
      const fake = fakeApi(served("America/Denver"));
      await fake.client.getWorkspace();
      at(DENVER_EVENING);
      expect(fake.client.today()).toBe("2026-11-20");
      vi.setSystemTime(DENVER_AFTER_MIDNIGHT);
      expect(fake.client.today()).toBe("2026-11-21");
      expect(fake.calls()).toEqual(["GET /company"]);
    });

    it("AD3 learns the zone from the people list too, which reads the same GET /company", async () => {
      const fake = fakeApi(served("America/Denver"));
      await fake.client.list("users");
      at(DENVER_EVENING);
      expect(fake.client.today()).toBe("2026-11-20");
    });

    it("AD4 keeps the browser's day when GET /company names a zone Intl doesn't know", async () => {
      const fake = fakeApi(served("Mars/Olympus_Mons"));
      await fake.client.getWorkspace();
      at(DENVER_EVENING);
      expect(fake.client.today()).toBe("2026-11-21");
    });

    it("AD5 keeps the last zone when a later GET /company is refused", async () => {
      let answer: { status: number; body?: unknown } = { status: 200, body: companyAnswer("America/Denver") };
      const fake = fakeApi({}, () => answer);
      await fake.client.getWorkspace();
      answer = { status: 503, body: { code: "maintenance", message: "Down for maintenance." } };
      await expect(fake.client.getWorkspace()).rejects.toThrow();
      at(DENVER_EVENING);
      expect(fake.client.today()).toBe("2026-11-20");
    });

    it("AD7 a switch to a company whose zone the browser doesn't know gives the browser's day, not the last company's", async () => {
      let zone = "America/Denver";
      const fake = fakeApi({}, () => ({ status: 200, body: companyAnswer(zone) }));
      await fake.client.getWorkspace();
      zone = "Mars/Olympus_Mons";
      await fake.client.getWorkspace();
      at(DENVER_EVENING);
      expect(fake.client.today()).toBe("2026-11-21");
    });

    it("AD8 leaving for the platform pages forgets the zone and closes the demo's company too", async () => {
      let closed = 0;
      const fake = fakeApi(served("America/Denver"), undefined, { closeCompany: () => void closed++ });
      await fake.client.getWorkspace();
      fake.client.closeCompany();
      at(DENVER_EVENING);
      expect(fake.client.today()).toBe("2026-11-21");
      expect(closed).toBe(1);
      expect(fake.calls()).toEqual(["GET /company"]);
    });
  });

  describe("with the browser in UTC", () => {
    inBrowserZone("UTC");

    it("AD6 is Denver's day between midnight UTC and midnight in Denver (the CI failure of PR #32)", async () => {
      const fake = fakeApi(served("America/Denver"));
      await fake.client.getWorkspace();
      // 01:44 UTC on the 21st is 18:44 on the 20th in Denver.
      at(new Date("2026-11-21T01:44:00Z"));
      expect(browserDay()).toBe("2026-11-21");
      expect(fake.client.today()).toBe("2026-11-20");
    });
  });
});

describe("DemoStore's today()", () => {
  describe("with the browser in Tokyo", () => {
    inBrowserZone("Asia/Tokyo");

    it("DD1 is the browser's day with no company open (sign-in, the platform console)", () => {
      at(DENVER_EVENING);
      expect(new DemoStore(noFiles).today()).toBe("2026-11-21");
    });

    it("DD2 is Summit's day in Denver, worked out on every call, so it rolls over at Denver's midnight", async () => {
      at(DENVER_EVENING);
      const store = new DemoStore(noFiles);
      await store.openCompany("summit", { userId: "sm-usr-01", viewAsRoleId: null });
      expect(store.today()).toBe("2026-11-20");
      vi.setSystemTime(DENVER_AFTER_MIDNIGHT);
      expect(store.today()).toBe("2026-11-21");
    });

    it("DD4 dates what it records with the company's day and stamps it with the company's clock", async () => {
      at(DENVER_EVENING);
      const store = new DemoStore(noFiles);
      await store.openCompany("summit", { userId: "sm-usr-01", viewAsRoleId: null });
      const customer = await store.createCustomer({ name: "Late Evening Builders" });
      expect(customer.createdAt).toBe("2026-11-20");
      const audit = (await store.list("audit")).find((entry) => entry.target === "Late Evening Builders");
      expect(audit?.at).toBe("2026-11-20T23:30");
    });
  });

  describe("with the browser in Los Angeles", () => {
    inBrowserZone("America/Los_Angeles");

    it("DD3 follows the open company's own zone: Harbor is in New York", async () => {
      // 05:30 UTC on the 21st: 21:30 on the 20th in Los Angeles, 00:30 on the 21st in New York.
      at(new Date("2026-11-21T05:30:00Z"));
      const store = new DemoStore(noFiles);
      await store.openCompany("harbor", { userId: "hb-usr-01", viewAsRoleId: null });
      expect(browserDay()).toBe("2026-11-20");
      expect(store.today()).toBe("2026-11-21");
    });
  });
});
