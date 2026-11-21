import { branches, rolePermissions, roles, userProfiles } from "@workspace/db/company";
import { tenantModuleOverrides } from "@workspace/db/control";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import {
  FEATURES,
  TRIAL_BALANCE_HIDDEN,
  type DataScope,
  type PermissionKey,
  type PostingDraft,
  type ReportOptions,
  type TrialBalance,
} from "@workspace/shared";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import type { Response } from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LedgerService } from "../src/core/ledger/ledger.service";
import { AuthHarness, PASSWORD, sessionCookie } from "./auth-harness";

const PATH = "/ledger/trial-balance";
const COST: PermissionKey[] = [
  "reports.financial.view",
  "sales.margin.view_sensitive",
  "inventory.product.view_sensitive",
];

/** Custom roles at the edges of the sight rule (ADR 0055 "Trial balance"). */
const CUSTOM_ROLES: Record<string, { scope: DataScope; keys: PermissionKey[] }> = {
  tb_nomargin: { scope: "all", keys: ["reports.financial.view", "reports.financial.export"] },
  tb_nocost: { scope: "all", keys: ["reports.financial.view", "sales.margin.view_sensitive"] },
  tb_cost: { scope: "all", keys: COST },
  tb_costpay: { scope: "all", keys: [...COST, "hr.payroll.view"] },
  tb_full: { scope: "all", keys: [...COST, "hr.payroll.view", "contracts.contract.view_sensitive"] },
  tb_branch: { scope: "branch", keys: [...COST, "hr.payroll.view", "contracts.contract.view_sensitive"] },
};

/** A balanced two-line draft from one source, as the modules post them. */
function draft(
  event: PostingDraft["event"],
  sourceType: PostingDraft["sourceType"],
  date: string,
  debit: string,
  credit: string,
  amount: string,
): PostingDraft {
  const line = (account: string, d: string, c: string) => ({
    account: account as PostingDraft["lines"][number]["account"],
    debit: d,
    credit: c,
    locationId: null,
    customerId: null,
  });
  return {
    event,
    sourceType,
    sourceId: uuidv7(),
    sourceNumber: `TB-${event}`,
    date,
    memo: "trial balance test",
    lines: [line(debit, amount, "0.00"), line(credit, "0.00", amount)],
  };
}

/**
 * The Trial balance on the API (ADR 0055 "Trial balance"; owner question 7, safer direction): the
 * route's refusals in order, the sight rule on the journal's facts, the options list that hides the
 * report from everyone the route refuses, the hub switch, and the answer itself.
 */
describe("trial balance (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  const cookies: Record<string, string> = {};

  function call(path: string, cookie?: string) {
    let test = request(harness.app.getHttpServer()).get(path).set("X-Forwarded-Host", "localhost:3000");
    if (cookie) test = test.set("Cookie", cookie);
    return test;
  }

  function status(response: Response, expected: number): void {
    expect(response.status, `${response.status} ${JSON.stringify(response.body).slice(0, 300)}`).toBe(expected);
  }

  async function read(cookie: string, path = PATH): Promise<TrialBalance> {
    const response = await call(path, cookie);
    status(response, 200);
    return response.body as TrialBalance;
  }

  async function hidden(cookie: string): Promise<void> {
    const response = await call(PATH, cookie);
    status(response, 403);
    expect(response.body).toEqual({ code: "forbidden", message: TRIAL_BALANCE_HIDDEN });
  }

  async function offered(cookie: string): Promise<boolean> {
    const response = await call("/reports/options", cookie);
    status(response, 200);
    return (response.body as ReportOptions).reports.includes("trial-balance");
  }

  async function enrolled(email: string) {
    const first = await harness.signIn(email);
    const enabled = await harness.post("/api/auth/two-factor/enable").set("Cookie", first).send({ password: PASSWORD });
    const secret = totpSecretFromUri(enabled.body.totpURI as string);
    const confirmed = await harness
      .post("/api/auth/two-factor/verify-totp")
      .set("Cookie", first)
      .send({ code: totpCode(secret) });
    return sessionCookie(confirmed.headers["set-cookie"]);
  }

  async function post(posting: PostingDraft): Promise<void> {
    const handle = await harness.companyDb(company.id);
    try {
      await handle.db.transaction(async (tx) => {
        await harness.app.get(LedgerService).post(tx, posting, uuidv7());
      });
    } finally {
      await handle.close();
    }
  }

  async function withHubOff(run: () => Promise<void>) {
    const feature = FEATURES["reports.hub"] as { enabled: boolean };
    feature.enabled = false;
    try {
      await run();
    } finally {
      feature.enabled = true;
    }
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("tb");
    let branchId = "";
    const handle = await harness.companyDb(company.id);
    try {
      const [branch] = await handle.db
        .insert(branches)
        .values({ name: "Denver", city: "Denver", state: "CO" })
        .returning();
      branchId = branch!.id;
      for (const [key, role] of Object.entries(CUSTOM_ROLES)) {
        const [made] = await handle.db.insert(roles).values({ key, name: key, dataScope: role.scope }).returning();
        await handle.db
          .insert(rolePermissions)
          .values(role.keys.map((permissionKey) => ({ roleId: made!.id, permissionKey })));
      }
    } finally {
      await handle.close();
    }
    for (const key of ["owner", "accountant", "sales", ...Object.keys(CUSTOM_ROLES)]) {
      const email = await harness.addUser({ companyIds: [company.id], roles: [key] });
      if (CUSTOM_ROLES[key]?.scope === "branch") {
        const userId = await harness.userIdOf(email);
        const db = await harness.companyDb(company.id);
        try {
          await db.db.update(userProfiles).set({ branchId }).where(eq(userProfiles.userId, userId));
        } finally {
          await db.close();
        }
      }
      cookies[key] = await enrolled(email);
    }
  }, 180_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("refuses without a session, without the key, and outside data scope all", async () => {
    status(await call(PATH), 401);
    status(await call(PATH, cookies.sales), 403);
    const branch = await call(PATH, cookies.tb_branch);
    status(branch, 403);
    expect(branch.body).toEqual({ code: "forbidden", message: "The books cover the whole company." });
    expect(await offered(cookies.tb_branch!)).toBe(false);
  });

  it("refuses a bad day before reading anything", async () => {
    status(await call(`${PATH}?through=2026-02-30`, cookies.owner), 400);
    status(await call(`${PATH}?through=yesterday`, cookies.owner), 400);
  });

  it("answers an empty, balanced book that no browser keeps", async () => {
    const response = await call(PATH, cookies.owner);
    status(response, 200);
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body).toMatchObject({ through: null, debit: "0.00", credit: "0.00", balanced: true });
  });

  it("always needs the margin rule (sales margin and product cost)", async () => {
    await hidden(cookies.tb_nomargin!);
    await hidden(cookies.tb_nocost!);
    expect(await offered(cookies.tb_nomargin!)).toBe(false);
    expect(await offered(cookies.tb_nocost!)).toBe(false);
    // The rest of the hub is unchanged for them.
    const options = (await call("/reports/options", cookies.tb_nomargin).expect(200)).body as ReportOptions;
    expect(options.reports).toEqual(["business", "pnl", "payments"]);
  });

  it("shows a sale and its cost through a day, with every account and the totals", async () => {
    await post(draft("invoice.issued", "invoice", "2026-01-10", "accounts_receivable", "sales", "100.00"));
    await post(draft("goods.issued", "stock_issue", "2026-02-10", "cost_of_goods_sold", "inventory", "40.00"));
    const all = await read(cookies.tb_cost!);
    expect(all).toMatchObject({ through: null, debit: "140.00", credit: "140.00", balanced: true });
    const byKey = new Map(all.rows.map((row) => [row.key, row]));
    expect(byKey.get("cost_of_goods_sold")).toMatchObject({ debit: "40.00", credit: "0.00", balance: "40.00" });
    expect(byKey.get("sales")).toMatchObject({ debit: "0.00", credit: "100.00", balance: "-100.00" });
    expect(all.rows.map((row) => row.code)).toEqual([...all.rows.map((row) => row.code)].sort());
    const january = await read(cookies.tb_cost!, `${PATH}?through=2026-01-31`);
    expect(january).toMatchObject({ through: "2026-01-31", debit: "100.00", credit: "100.00", balanced: true });
    expect(new Map(january.rows.map((row) => [row.key, row.debit])).get("cost_of_goods_sold")).toBe("0.00");
    expect(await offered(cookies.tb_cost!)).toBe(true);
  });

  it("needs pay sight once pay has posted, by its account or its source, on any date", async () => {
    // A payroll expense posts to Wages from an ordinary expense: caught by the account.
    await post(draft("expense.confirmed", "expense", "2026-03-15", "wages", "cash", "25.00"));
    await hidden(cookies.tb_cost!);
    await post(draft("payroll.approved", "pay_period", "2026-03-31", "wages", "accrued_payroll", "500.00"));
    await hidden(cookies.tb_cost!);
    // Asking for a day before the pay doesn't get round it.
    status(await call(`${PATH}?through=2026-01-31`, cookies.tb_cost), 403);
    expect(await offered(cookies.tb_cost!)).toBe(false);
    expect((await read(cookies.tb_costpay!)).debit).toBe("665.00");
    expect(await offered(cookies.tb_costpay!)).toBe(true);
  });

  it("needs contract cost sight once a contract has posted, by its source or a Retainage Payable line", async () => {
    // Retainage withheld from a subcontractor shows what the subcontract cost, whichever source
    // posted it, such as the seed's opening balances (ADR 0062): caught by the account.
    await post(draft("opening_balance.posted", "opening_balance", "2026-04-01", "cash", "retainage_payable", "5.00"));
    await hidden(cookies.tb_costpay!);
    expect(await offered(cookies.tb_costpay!)).toBe(false);
    await post(
      draft(
        "contract_billing.posted",
        "contract_billing",
        "2026-04-01",
        "cost_of_goods_sold",
        "accounts_payable",
        "10.00",
      ),
    );
    await hidden(cookies.tb_costpay!);
    expect(await offered(cookies.tb_costpay!)).toBe(false);
    for (const key of ["tb_full", "owner", "accountant"]) {
      expect(await read(cookies[key]!)).toMatchObject({ debit: "680.00", credit: "680.00", balanced: true });
      expect(await offered(cookies[key]!)).toBe(true);
    }
  });

  it("refuses an Owner whose company switched HR off once pay has posted (pay sight, S3)", async () => {
    await harness.control.db
      .insert(tenantModuleOverrides)
      .values({ tenantId: company.id, module: "hr", enabled: false });
    try {
      await hidden(cookies.owner!);
      expect(await offered(cookies.owner!)).toBe(false);
    } finally {
      await harness.control.db
        .delete(tenantModuleOverrides)
        .where(and(eq(tenantModuleOverrides.tenantId, company.id), eq(tenantModuleOverrides.module, "hr")));
    }
    await read(cookies.owner!);
  });

  it("is Flooring Suite only, like the hub: an HR Suite Owner gets the product refusal", async () => {
    const hrCompany = await harness.provisionCompany("tbhr", ["hr"]);
    const owner = await enrolled(await harness.addUser({ companyIds: [hrCompany.id], roles: ["owner"] }));
    const response = await call(PATH, owner);
    status(response, 403);
    expect(response.body.code).toBe("product_not_enabled");
  });

  it("is hidden with the Reports hub switched off (CLAUDE.md rule 13)", async () => {
    await withHubOff(async () => {
      status(await call(PATH, cookies.owner), 404);
      status(await call("/reports/options", cookies.owner), 404);
    });
    await read(cookies.owner!);
  });
});
