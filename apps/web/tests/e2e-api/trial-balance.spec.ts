import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetAuthState } from "@workspace/db/testing";
import { ACCOUNTANT_EMAIL, MANAGER_EMAIL, SALES_EMAIL, signInAndEnrol, signInAs } from "./accounts";

/** The control database the API uses (global-setup.ts checks it is set). */
const CONTROL_URL = process.env.CONTROL_DATABASE_URL ?? "";

/** One account of GET /ledger/trial-balance's answer, as far as the spec reads it. */
interface Row {
  name: string;
  type: string;
}

/** Each kind of account and the heading its group shows. */
const GROUPS = [
  ["asset", "Assets"],
  ["liability", "Liabilities"],
  ["equity", "Equity"],
  ["revenue", "Revenue"],
  ["expense", "Expenses"],
] as const;

/** Waits for the trial balance's answer, through any day. */
function trialBalanceResponse(page: Page) {
  return page.waitForResponse((r) => new URL(r.url()).pathname === "/api-proxy/ledger/trial-balance");
}

/** The reports nav's buttons, by name. */
function navNames(page: Page): Promise<string[]> {
  return page.getByRole("navigation", { name: "Reports" }).getByRole("button").allTextContents();
}

/**
 * The Trial balance on the real API (ADR 0055 "Trial balance"): the Accountant opens it from the
 * Reports hub, sees the books grouped by kind with their totals and whether they balance, moves
 * the As of day, and exports the CSV; a Manager and a sales rep are never offered it and the API
 * refuses them. Everything here reads, so the database is as it was afterwards. The Accountant
 * needs an authenticator app, so its sign-in state is reset before and after.
 */
test.describe("trial balance (api mode)", () => {
  test.beforeAll(async () => {
    await resetAuthState(CONTROL_URL, [ACCOUNTANT_EMAIL]);
  });

  test.afterAll(async () => {
    await resetAuthState(CONTROL_URL, [ACCOUNTANT_EMAIL]);
  });

  test("the Accountant reads the books as of a day, and the CSV agrees with the screen", async ({ page }) => {
    const methods: string[] = [];
    page.on("request", (r) => {
      const path = new URL(r.url()).pathname;
      if (path.startsWith("/api-proxy/ledger") || path.startsWith("/api-proxy/reports")) methods.push(r.method());
    });
    await signInAndEnrol(page, ACCOUNTANT_EMAIL);
    await page.goto("/reports");
    await expect(
      page.getByRole("navigation", { name: "Reports" }).getByRole("button", { name: "Trial balance" }),
    ).toBeVisible();
    expect(await navNames(page)).toEqual([
      "Business report",
      "Profit and loss",
      "Sales by category",
      "Payments received",
      "Trial balance",
    ]);

    const table = page.getByRole("region", { name: "Trial balance table" });
    let rows: Row[] = [];
    await test.step("opens from the hub with its totals and whether the books balance", async () => {
      const answer = trialBalanceResponse(page);
      await page.getByRole("navigation", { name: "Reports" }).getByRole("button", { name: "Trial balance" }).click();
      const response = await answer;
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"] ?? "").toContain("no-store");
      const body = (await response.json()) as { balanced: boolean; rows: Row[] };
      rows = body.rows;
      expect(page.url()).toContain("report=trial-balance");
      await expect(table.getByRole("rowheader", { name: "Total", exact: true })).toBeVisible();
      await expect(page.getByText(body.balanced ? "Balanced" : "Out of balance", { exact: true })).toBeVisible();
      await expect(table.getByRole("columnheader", { name: "Debits" })).toBeVisible();
    });

    await test.step("shows every account when asked, grouped by kind", async () => {
      await page.getByRole("switch").click();
      // Accounts are made by the first posting (ADR 0039), so a fresh database has none yet.
      if (rows.length === 0) {
        await expect(table.getByText("Nothing has been recorded in the books through this day.")).toBeVisible();
        return;
      }
      for (const [type, group] of GROUPS) {
        const heading = table.getByRole("rowheader", { name: group, exact: true });
        await expect(heading).toHaveCount(rows.some((row) => row.type === type) ? 1 : 0);
      }
      for (const row of rows) await expect(table.getByRole("rowheader", { name: row.name, exact: true })).toBeVisible();
    });

    await test.step("reads the books through an earlier day", async () => {
      const answer = trialBalanceResponse(page);
      await page.getByLabel("As of").fill("2020-01-31");
      const response = await answer;
      expect(new URL(response.url()).searchParams.get("through")).toBe("2020-01-31");
      expect(response.status()).toBe(200);
      await expect(table).not.toHaveAttribute("aria-busy", "true");
    });

    await test.step("exports the accounts on screen and the totals", async () => {
      const download = page.waitForEvent("download");
      await page.getByRole("button", { name: "Export CSV" }).click();
      const file = await download;
      expect(file.suggestedFilename()).toBe("trial-balance-2020-01-31.csv");
      const lines = readFileSync(await file.path(), "utf8")
        .trim()
        .split(/\r?\n/);
      expect(lines[0]).toBe("Code,Account,Type,Debits,Credits,Balance");
      expect(lines.at(-1)).toMatch(/^,Total,,/);
      const accounts = await table.locator("tbody tr:has(td:nth-child(3))").count();
      expect(lines).toHaveLength(accounts + 2);
    });

    expect(new Set(methods)).toEqual(new Set(["GET"]));
  });

  test("a Manager and a sales rep are never offered it, and the API refuses them", async ({ page }) => {
    for (const email of [MANAGER_EMAIL, SALES_EMAIL]) {
      await signInAs(page, email);
      await page.goto("/reports?report=trial-balance");
      await expect(page.getByRole("navigation", { name: "Reports" })).toBeVisible();
      expect(await navNames(page)).not.toContain("Trial balance");
      const refused = await page.request.get("/api-proxy/ledger/trial-balance");
      expect(refused.status()).toBe(403);
      expect(await refused.json()).toMatchObject({ code: "forbidden" });
      await page.context().clearCookies();
    }
  });
});
