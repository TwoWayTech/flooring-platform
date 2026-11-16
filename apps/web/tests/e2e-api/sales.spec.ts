import { expect, test, type Locator, type Page } from "@playwright/test";
import type { Product, Quote } from "@workspace/shared";
import { MANAGER_EMAIL, SALES_EMAIL, signInAs } from "./accounts";
import { addProduct, FIELDSTONE, waitForAnswer } from "./flows/kit";

/**
 * The product bug that stops the B5 test below (STATUS B5, found in B1's audit, session log
 * 2026-11-16-2320). Until it is fixed the test is `fixme`, written to the behaviour the spec asks for.
 */
const BLOCKED_BY_B5 = [
  {
    type: "issue",
    description:
      "api mode: a salesperson's dashboard (her landing page) shows 'This page could not load its data.', because " +
      "GET /invoices leaves out `cost` for anyone without product cost (rule 5) and monthlyPnl, salesTotals, " +
      "bestSellersIn and the dashboard's margin sparkline add or subtract it (dec(undefined)). Sales → Team's " +
      "teamStats reads it too, but loads today only because its people still come from DemoStore. B5, STATUS follow-up.",
  },
];

/** The quote builder's Summary panel. */
function summaryOf(page: Page): Locator {
  return page.getByRole("region", { name: "Summary" });
}

/** The Margin row's label in a summary. */
function marginRow(summary: Locator): Locator {
  return summary.locator("dt").filter({ hasText: /^Margin$/ });
}

/** The two ways a screen fails: its data didn't load, or it threw while rendering. */
function failures(page: Page): Locator {
  return page.getByText("This page could not load its data.").or(page.getByText("This screen stopped working."));
}

/**
 * Sales, part 1 on the real API (ADR 0037): Summit's quotes and customers come from its own
 * database, within each person's scope. Cost and margin reach only those who may see them
 * (CLAUDE.md rule 5; ADR 0037, 2026-11-16).
 */
test.describe("sales (api mode)", () => {
  test("a manager sees their branch's quotes and customers from the API", async ({ page }) => {
    await signInAs(page, MANAGER_EMAIL);
    await page.goto("/sales?view=quotes");
    await expect(page.getByText("Q-2001").first()).toBeVisible();
  });

  test("a salesperson's quote builder works without cost: no cost reaches her browser and no margin shows (B1)", async ({
    page,
  }) => {
    // She lands on her dashboard, which fails until B5; nothing below is checked there.
    await signInAs(page, SALES_EMAIL);
    const productsAnswer = waitForAnswer<Product[]>(page, "GET", /^\/api-proxy\/products$/);
    const quotesAnswer = waitForAnswer<Quote[]>(page, "GET", /^\/api-proxy\/quotes$/);
    await page.goto("/sales/quotes/new");
    const [products, quotes] = await Promise.all([productsAnswer, quotesAnswer]);
    const errors: string[] = [];
    page.on("pageerror", (error) => {
      if (new URL(page.url()).pathname.startsWith("/sales/quotes/")) errors.push(error.message);
    });

    expect(products.length, "her catalog").toBeGreaterThan(0);
    expect(products.filter((product) => "cost" in product).length, "products carrying cost").toBe(0);
    const lines = quotes.flatMap((quote) => quote.lines);
    expect(lines.filter((line) => "unitCost" in line).length, "quote lines carrying unitCost").toBe(0);

    await addProduct(page, FIELDSTONE);
    await expect(page.getByLabel(`${FIELDSTONE.line} quantity`, { exact: true })).toBeVisible();
    const summary = summaryOf(page);
    await expect(summary.getByText("Total", { exact: true })).toBeVisible();
    await expect(marginRow(summary)).toHaveCount(0);
    await expect(summary.getByText(/^Cost/)).toHaveCount(0);

    // One of her saved quotes, as the API answered it: without cost.
    const saved = quotes.find((quote) => quote.lines.some((line) => line.productId));
    if (!saved) throw new Error("Priya has no saved quote with a product line.");
    const line = saved.lines.find((candidate) => candidate.productId)!;
    await page.goto(`/sales/quotes/${saved.id}`);
    await expect(page.getByRole("heading", { name: `Quote ${saved.number}` })).toBeVisible();
    await expect(page.getByText(line.description).first()).toBeVisible();
    await expect(summary.getByText("Total", { exact: true })).toBeVisible();
    await expect(marginRow(summary)).toHaveCount(0);

    await expect(page.getByText("This screen stopped working.")).toHaveCount(0);
    expect(errors.filter((message) => message.includes("DecimalError"))).toEqual([]);
  });

  test("a manager sees a quote's margin and the cost under it from the API (B1)", async ({ page }) => {
    await signInAs(page, MANAGER_EMAIL);
    const quotesAnswer = waitForAnswer<Quote[]>(page, "GET", /^\/api-proxy\/quotes$/);
    await page.goto("/sales?view=quotes");
    const quote = (await quotesAnswer).find((candidate) => candidate.number === "Q-2001");
    if (!quote) throw new Error("Q-2001 is not in Luis's answer.");
    expect(
      quote.lines.every((line) => "unitCost" in line),
      "Summit's ceiling gives the Manager product cost",
    ).toBe(true);

    await page.goto(`/sales/quotes/${quote.id}`);
    const summary = summaryOf(page);
    await expect(marginRow(summary)).toBeVisible();
    await expect(summary.getByText(/^Cost /)).toBeVisible();
  });

  // Sales → Team is left out: it loads today only because its people come from DemoStore (session log
  // 2026-11-16-2320, the B5 probe), so a check there would pass whatever B5 does.
  test.fixme("a salesperson's dashboard loads without cost (B5)", { annotation: BLOCKED_BY_B5 }, async ({ page }) => {
    await signInAs(page, SALES_EMAIL);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Revenue", { exact: true }).first()).toBeVisible();
    await expect(failures(page)).toHaveCount(0);
  });
});
