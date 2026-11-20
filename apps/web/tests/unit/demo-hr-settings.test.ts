import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HR_MESSAGES,
  payFrequencyProblem,
  SETTINGS_SCOPE_MESSAGE,
  type CompanyId,
  type FeatureKey,
  type FeatureRegister,
  type HrSettings,
  type Role,
} from "@workspace/shared";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

/** Switches these tests turn off; every other one keeps its real value. */
const OFF = vi.hoisted(() => new Set<string>());

vi.mock("@workspace/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/shared")>();
  return {
    ...real,
    featureOn: (key: FeatureKey, register?: FeatureRegister) => (OFF.has(key) ? false : real.featureOn(key, register)),
  };
});

/**
 * How Summit opens: `fresh` drops its pay periods, timesheets and clock punches (a company that has
 * recorded no pay yet); `california` makes its first employee a California non-exempt worker.
 */
const SUMMIT = vi.hoisted(() => ({ fresh: false, california: false }));

vi.mock("@/lib/api/demo/fixtures", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/api/demo/fixtures")>();
  return {
    ...real,
    loadCompanyFixtures: async (companyId: CompanyId) => {
      const fixtures = await real.loadCompanyFixtures(companyId);
      if (companyId !== "summit") return fixtures;
      const patched = { ...fixtures };
      if (SUMMIT.fresh) Object.assign(patched, { payPeriods: [], timesheets: [], clockEntries: [] });
      if (SUMMIT.california) {
        const [first, ...rest] = fixtures.employees;
        patched.employees = [{ ...first!, state: "CA", flsaStatus: "non_exempt", status: "active" }, ...rest];
      }
      return patched;
    },
  };
});

afterEach(() => {
  OFF.clear();
  SUMMIT.fresh = false;
  SUMMIT.california = false;
});

/** Summit's Owner and Sales rep; Harbor's HR manager (HR Suite). */
const DANA = "sm-usr-01";
const PRIYA = "sm-usr-03";
const HARBOR_HR = "hb-usr-02";
const ROLE_REFUSAL = "Your role does not allow this. Ask an Owner to change your security role.";

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

/** A fresh demo store with a company open for one person. */
async function open(company: "summit" | "harbor", userId: string): Promise<DemoStore> {
  const store = new DemoStore(noFiles);
  await store.openCompany(company, { userId, viewAsRoleId: null });
  return store;
}

/** Expects a Settings → HR save to be refused with `message`, leaving the section and the audit log as they were. */
async function expectRefused(store: DemoStore, value: HrSettings, message: string): Promise<void> {
  const before = (await store.getSettings()).hr;
  const audits = (await store.list("audit")).length;
  await expect(store.updateSettings("hr", value)).rejects.toThrow(message);
  expect((await store.getSettings()).hr).toEqual(before);
  expect(await store.list("audit")).toHaveLength(audits);
}

/**
 * DemoStore's Settings → HR follows the API's rules (ADR 0059, part 5): the same keys, switch, scope
 * and content words, the schedule lock against its own pay periods, timesheets and punches (D4), and
 * the monthly rule on a change of frequency (D5). Its step-up is the dialog alone.
 */
describe("DemoStore Settings → HR (ADR 0059, part 5)", () => {
  it("HD1 the Owner saves holidays and switches: stored, one audit entry with the section's label", async () => {
    const store = await open("summit", DANA);
    const hr = (await store.getSettings()).hr;
    const value = {
      ...hr,
      showTeamCalendarToEmployees: !hr.showTeamCalendarToEmployees,
      holidays: [...hr.holidays, { date: "2027-12-24", name: "Shop closed" }],
    };
    const seen = new Set((await store.list("audit")).map((row) => row.id));
    await store.updateSettings("hr", value);
    expect((await store.getSettings()).hr).toEqual(value);
    const added = (await store.list("audit")).filter((row) => !seen.has(row.id));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ category: "settings", action: "Changed hr", target: "HR" });
  });

  it("HD2 the shared content rule refuses with its words, nothing stored or audited", async () => {
    const store = await open("summit", DANA);
    const hr = (await store.getSettings()).hr;
    await expectRefused(store, { ...hr, workweekStartDay: 7 }, HR_MESSAGES.workweekStartDay);
    await expectRefused(store, { ...hr, payPeriodAnchor: "2026-02-30" }, HR_MESSAGES.payPeriodAnchor);
    const twice = [...hr.holidays, { ...hr.holidays[0]!, name: "Again" }];
    await expectRefused(store, { ...hr, holidays: twice }, HR_MESSAGES.holidayTwice);
  });

  it("HD3 with pay periods and hours recorded, the frequency, the anchor and the workweek are fixed", async () => {
    const store = await open("summit", DANA);
    const hr = (await store.getSettings()).hr;
    expect((await store.list("payPeriods")).length).toBeGreaterThan(0);
    await expectRefused(store, { ...hr, payFrequency: "weekly" }, HR_MESSAGES.scheduleLocked);
    await expectRefused(store, { ...hr, payPeriodAnchor: "2026-01-05" }, HR_MESSAGES.scheduleLocked);
    await expectRefused(store, { ...hr, workweekStartDay: (hr.workweekStartDay + 1) % 7 }, HR_MESSAGES.workweekLocked);
  });

  it("HD4 a company with no pay periods, timesheets or punches may still change its schedule and workweek", async () => {
    SUMMIT.fresh = true;
    const store = await open("summit", DANA);
    const hr = (await store.getSettings()).hr;
    const value = { ...hr, payFrequency: "weekly" as const, payPeriodAnchor: "2026-01-05", workweekStartDay: 0 };
    await store.updateSettings("hr", value);
    expect((await store.getSettings()).hr).toEqual(value);
  });

  it("HD5 monthly with California non-exempt staff is refused on a change of frequency, in the pay rule's words", async () => {
    SUMMIT.fresh = true;
    SUMMIT.california = true;
    const store = await open("summit", DANA);
    const hr = (await store.getSettings()).hr;
    const words = payFrequencyProblem("monthly", await store.list("employees"))!;
    expect(words).toBe("California non-exempt staff must be paid at least twice a month.");
    await expectRefused(store, { ...hr, payFrequency: "monthly" }, words);
    await store.updateSettings("hr", { ...hr, payFrequency: "semimonthly" });
    expect((await store.getSettings()).hr.payFrequency).toBe("semimonthly");
  });

  it("HD6 the key, the switch and company-wide scope come first, as on the API", async () => {
    const sales = await open("summit", PRIYA);
    const hr = (await sales.getSettings()).hr;
    await expect(sales.updateSettings("hr", hr)).rejects.toThrow(ROLE_REFUSAL);
    OFF.add("settings.hr");
    const owner = await open("summit", DANA);
    await expect(owner.updateSettings("hr", { ...hr, workweekStartDay: 9 })).rejects.toThrow(
      "This feature is switched off.",
    );
    OFF.clear();
    const narrow: Role = {
      ...(await owner.list("roles")).find((role) => role.key === "hr")!,
      id: "sm-role-branch-hr",
      key: "branch-hr",
      name: "Branch HR",
      system: false,
      permissions: ["settings.hr.manage"],
      dataScope: "branch",
    };
    await owner.saveRole(narrow);
    owner.setViewer({ userId: DANA, viewAsRoleId: narrow.id });
    await expect(owner.updateSettings("hr", hr)).rejects.toThrow(SETTINGS_SCOPE_MESSAGE);
  });

  it("HD7 the HR Suite's HR manager saves its switches; Harbor's schedule is fixed by its own pay periods", async () => {
    const store = await open("harbor", HARBOR_HR);
    const hr = (await store.getSettings()).hr;
    await store.updateSettings("hr", { ...hr, clockEnabled: !hr.clockEnabled });
    expect((await store.getSettings()).hr.clockEnabled).toBe(!hr.clockEnabled);
    await expectRefused(store, { ...hr, payFrequency: "biweekly" }, HR_MESSAGES.scheduleLocked);
  });
});
