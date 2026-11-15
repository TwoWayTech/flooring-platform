import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { resetAuthState } from "@workspace/db/testing";
import { REPORT_WHOLE_COMPANY } from "@workspace/shared";
import { MANAGER_EMAIL, OWNER_EMAIL, SALES_EMAIL, signInAndEnrolOwner, signInAs } from "./accounts";

/** The control database the API uses (global-setup.ts checks it is set). */
const CONTROL_URL = process.env.CONTROL_DATABASE_URL ?? "";

/** The reports requests a page makes, whatever their method: a report only ever reads. */
function watchReportRequests(page: Page): string[] {
  const methods: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api-proxy/reports")) methods.push(r.method());
  });
  return methods;
}

/** Waits for the answer to one report route, whatever its filters. */
function reportResponse(page: Page, route: string) {
  return page.waitForResponse((r) => new URL(r.url()).pathname === `/api-proxy/reports/${route}`);
}

/** The reports nav's buttons, by name. */
function navNames(page: Page): Promise<string[]> {
  return page.getByRole("navigation", { name: "Reports" }).getByRole("button").allTextContents();
}

/** Downloads through the page's Export CSV button and returns the file's text. */
async function exportCsv(page: Page, stem: RegExp): Promise<{ name: string; text: string }> {
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(stem);
  return { name: file.suggestedFilename(), text: readFileSync(await file.path(), "utf8") };
}

/**
 * Reports on the real API (module 15, ADR 0055): the screens show what apps/api answers, the exports
 * agree with the screen, and the data-scope and cost rules hold end to end. Everything here is a
 * read, so the database is as it was afterwards. The Owner needs an authenticator app, so its
 * sign-in state is reset before and after, like the other specs that enrol it.
 */
test.describe("reports (api mode)", () => {
  test.beforeAll(async () => {
    await resetAuthState(CONTROL_URL, [OWNER_EMAIL]);
  });

  test.afterAll(async () => {
    await resetAuthState(CONTROL_URL, [OWNER_EMAIL]);
  });

  test("the Owner's Business report agrees with itself on screen and in the CSV, and the hub reports load", async ({
    page,
  }) => {
    const methods = watchReportRequests(page);
    await signInAndEnrolOwner(page);

    await test.step("E2E-1 the Business report from /reports/business", async () => {
      const answer = reportResponse(page, "business");
      await page.goto("/reports");
      const response = await answer;
      expect(response.status()).toBe(200);
      expect(response.headers()["cache-control"] ?? "").toContain("no-store");
      for (const title of [
        "Summary",
        "Profit by location",
        "Expenses by category",
        "Cash",
        "Taxes",
        "People costs",
        "Stock on hand",
      ])
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      for (const name of ["Denver Central", "Colorado Springs", "Summit Design Studio", "Southgate Showroom"])
        await expect(page.getByLabel(name, { exact: true })).toBeVisible();
    });

    await test.step("E2E-1 location profits add up to company profit, on screen", async () => {
      await page.getByRole("group", { name: "Profit by location view" }).getByRole("button", { name: "Table" }).click();
      const summaryNet = await page
        .getByRole("region", { name: "Summary", exact: true })
        .first()
        .getByRole("row", { name: /^Net profit, before income tax/ })
        .getByRole("cell")
        .first()
        .innerText();
      const locationTotal = page
        .getByRole("region", { name: "Profit by location", exact: true })
        .first()
        .getByRole("row", { name: /^Total/ })
        .getByRole("cell")
        .last();
      await expect(locationTotal).toHaveText(summaryNet);
    });

    await test.step("E2E-1 and in the exported file (the week-18 gate)", async () => {
      const { text } = await exportCsv(page, /^business-report-\d{4}-\d{2}-\d{2}\.csv$/);
      const lines = text.split(/\r?\n/);
      const summary = lines.find((l) => l.startsWith('Summary,"Net profit, before income tax",'));
      const total = lines.find((l) => l.startsWith("Profit by location,Total,"));
      expect(summary, "the Summary net profit line").toBeDefined();
      expect(total, "the Profit by location total line").toBeDefined();
      const summaryNow = summary!.slice('Summary,"Net profit, before income tax",'.length).split(",")[0];
      const locationNet = total!.split(",").at(-1);
      expect(locationNet).toMatch(/^-?\d+\.\d{2}$/);
      expect(locationNet).toBe(summaryNow);
    });

    await test.step("E2E-2 P&L, Sales by category and Payments received", async () => {
      for (const [report, route, label] of [
        ["pnl", "pnl", "Profit and loss"],
        ["sales", "sales-by-category", "Sales by category"],
        ["payments", "payments", "Payments received"],
      ] as const) {
        const answer = reportResponse(page, route);
        await page.getByRole("navigation", { name: "Reports" }).getByRole("button", { name: label }).click();
        expect((await answer).status()).toBe(200);
        const table = page.getByRole("region", { name: `${label} table` });
        await expect(table.getByRole("cell", { name: "Total", exact: true })).toBeVisible();
        expect(page.url()).toContain(`report=${report}`);
      }

      // Payments received is open: Method Check leaves only checks, and the CSV agrees with the rows.
      const table = page.getByRole("region", { name: "Payments received table" });
      await page.getByLabel("Method").click();
      await page.getByRole("option", { name: "Check" }).click();
      const cells = table.locator("tbody tr td:nth-child(5)");
      await expect.poll(async () => [...new Set(await cells.allTextContents())]).toEqual(["Check"]);
      await expect(table).not.toHaveAttribute("aria-busy", "true");
      const rows = (await cells.allTextContents()).length;
      expect(rows).toBeGreaterThan(0);
      const { text } = await exportCsv(page, /^payments-\d{4}-\d{2}-\d{2}\.csv$/);
      // Header, one line per payment, and the totals row.
      expect(text.trim().split(/\r?\n/)).toHaveLength(rows + 2);
    });

    // Reports only read, so the run leaves the database as it found it.
    expect(methods.length).toBeGreaterThan(0);
    expect(new Set(methods)).toEqual(new Set(["GET"]));
  });

  test("E2E-3 a manager is refused the company-wide reports and sees branch-scoped Sales by category", async ({
    page,
  }) => {
    const methods = watchReportRequests(page);
    await signInAs(page, MANAGER_EMAIL);
    await page.goto("/reports");
    await expect(page.getByRole("region", { name: "Sales by category table" })).toBeVisible();
    expect(await navNames(page)).toEqual(["Sales by category", "Payments received"]);
    await expect(page.getByRole("columnheader", { name: "Cost" })).toBeVisible();

    for (const path of ["business?from=2026-10-01&to=2026-10-31", "pnl"]) {
      const refused = await page.request.get(`/api-proxy/reports/${path}`);
      expect(refused.status()).toBe(403);
      expect(await refused.json()).toMatchObject({ code: "forbidden", message: REPORT_WHOLE_COMPANY });
    }
    expect(new Set(methods)).toEqual(new Set(["GET"]));
  });

  test("E2E-4 a sales rep sees Sales by category without cost or exports", async ({ page }) => {
    await signInAs(page, SALES_EMAIL);
    await page.goto("/reports");
    await expect(page.getByRole("region", { name: "Sales by category table" })).toBeVisible();
    expect(await navNames(page)).toEqual(["Sales by category"]);
    await expect(page.getByRole("columnheader", { name: "Revenue" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Cost" })).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Margin" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Export/ })).toHaveCount(0);

    const refused = await page.request.get("/api-proxy/reports/pnl");
    expect(refused.status()).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "forbidden" });
  });
});
