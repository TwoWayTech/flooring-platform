import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  dec,
  defaultNumberSettings,
  formatNumber,
  invoicesIn,
  periodRange,
  salesTotals,
  teamStats,
  type CompanyAnswer,
  type Customer,
  type Payment,
  type Product,
  type Quote,
  type TeamCommission,
  type ViewedInvoice,
} from "@workspace/shared";
import { MANAGER_EMAIL, SALES_EMAIL, signInAs } from "./accounts";
import { addDays, addProduct, choose, companyToday, FIELDSTONE, runId, waitForAnswer } from "./flows/kit";

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
    // She lands on her dashboard, which loads since B5 (checked in the B5 test below).
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

  test("a salesperson re-opens a saved quote and saves it again (B6)", async ({ page }) => {
    const customerName = `E2E Resave ${runId()}`;
    await signInAs(page, SALES_EMAIL);
    await page.goto("/sales/quotes/new");
    await page.getByLabel("Fulfilled from").click();
    await page.getByRole("option", { name: "Denver Central", exact: true }).click();
    await page.getByLabel("Customer", { exact: true }).click();
    await page.getByLabel("Search customers").fill(customerName);
    await page.getByRole("option", { name: `Add “${customerName}” as a new customer` }).click();
    const added = waitForAnswer<Customer>(page, "POST", /^\/api-proxy\/customers$/);
    await page.getByRole("form", { name: "New customer" }).getByRole("button", { name: "Add customer" }).click();
    await added;
    // As F1 does: the picker shows the new customer before anything is saved, so "Save as draft"
    // can't race the customer's dispatch and answer "Choose a customer…".
    await expect(page.getByLabel("Customer", { exact: true })).toHaveText(customerName);
    await addProduct(page, FIELDSTONE);
    const drafted = waitForAnswer<Quote>(page, "POST", /^\/api-proxy\/quotes$/);
    await page.getByRole("button", { name: "Save as draft" }).click();
    const quote = await drafted;
    await expect(page).toHaveURL(new RegExp(`/sales/quotes/${quote.id}$`));

    // Re-opened, the builder starts from the API's own answer, percents at their stored scale.
    const reread = waitForAnswer<Quote[]>(page, "GET", /^\/api-proxy\/quotes$/);
    await page.goto(`/sales/quotes/${quote.id}`);
    const stored = (await reread).find((candidate) => candidate.id === quote.id);
    if (!stored) throw new Error(`${quote.number} is not in Priya's answer.`);
    await expect(page.getByRole("heading", { name: `Quote ${quote.number}` })).toBeVisible();

    const resaved = waitForAnswer<Quote>(page, "PUT", new RegExp(`^/api-proxy/quotes/${quote.id}$`));
    const sent = page.waitForRequest(
      (r) => r.method() === "PUT" && new URL(r.url()).pathname === `/api-proxy/quotes/${quote.id}`,
    );
    await page.getByRole("button", { name: "Save as draft" }).click();
    const answer = await resaved;
    // It sends back what it was given, so the API must take its own answer (B6).
    const request = (await sent).postDataJSON() as Quote;
    expect(request.depositPct).toBe(stored.depositPct);
    expect(request.lines.map((line) => line.wastePct)).toEqual(stored.lines.map((line) => line.wastePct));
    expect(dec(answer.depositPct).eq(stored.depositPct), `deposit ${answer.depositPct}`).toBe(true);
    expect(answer.lines.filter((line) => "unitCost" in line).length, "answer lines carrying unitCost").toBe(0);
    await expect(page.getByText(`Quote ${quote.number} saved`).first()).toBeVisible();
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

  test("T1 Sales → Team shows a salesperson's own row from the API, without margin (B5; back with GET /company)", async ({
    page,
  }) => {
    await signInAs(page, SALES_EMAIL);
    const company = waitForAnswer<CompanyAnswer>(page, "GET", /^\/api-proxy\/company$/);
    const invoicesAnswer = waitForAnswer<ViewedInvoice[]>(page, "GET", /^\/api-proxy\/invoices$/);
    const paymentsAnswer = waitForAnswer<Payment[]>(page, "GET", /^\/api-proxy\/payments$/);
    const quotesAnswer = waitForAnswer<Quote[]>(page, "GET", /^\/api-proxy\/quotes$/);
    await page.goto("/sales?view=team");
    const today = companyToday();
    const range = periodRange("ytd", today);
    const totals = waitForAnswer<[string, TeamCommission][]>(page, "GET", /^\/api-proxy\/commission-totals$/, {
      from: range.from,
      to: range.to,
    });
    await choose(page, page.getByLabel("Period"), "Year to date");
    // Her row first: before GET /company, Team's people were DemoStore's and matched no API invoice.
    const row = page.getByRole("row", { name: /Priya Natarajan/ });
    await expect(row).toBeVisible();
    const [answer, invoices, payments, quotes, commission] = await Promise.all([
      company,
      invoicesAnswer,
      paymentsAnswer,
      quotesAnswer,
      totals,
    ]);
    expect(
      invoices.some((invoice) => !invoice.voidedAt && invoice.issuedAt >= range.from),
      "her answer has an invoice this year; the API seed keeps the fixture dates (to 2026-11-04)",
    ).toBe(true);
    const [expected] = teamStats(
      { users: [answer.me], invoices, payments, quotes, commission: new Map(commission) },
      { ...range, today, locationId: null },
    );
    expect(expected?.userId).toBe(answer.me.id);
    await expect(row).toContainText(formatNumber(expected.sales, "money", defaultNumberSettings()));
    await expect(row).toContainText(formatNumber(expected.paidRevenue, "money", defaultNumberSettings()));
    await expect(page.getByRole("columnheader", { name: /^Margin\b/ })).toHaveCount(0);
    await expect(failures(page)).toHaveCount(0);
  });

  test("T2 a manager's Team shows margin for his branch's reps (B5; back with GET /company)", async ({ page }) => {
    await signInAs(page, MANAGER_EMAIL);
    await page.goto("/sales?view=team");
    await choose(page, page.getByLabel("Period"), "Year to date");
    await expect(page.getByRole("row", { name: /Priya Natarajan/ })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: /^Margin\b/ })).toBeVisible();
    await expect(failures(page)).toHaveCount(0);
  });

  test("a salesperson's dashboard loads without cost and shows no margin (B5)", async ({ page }) => {
    await signInAs(page, SALES_EMAIL);
    const answer = waitForAnswer<ViewedInvoice[]>(page, "GET", /^\/api-proxy\/invoices$/);
    await page.goto("/");
    const invoices = await answer;

    // Rule 5 on her answer: no invoice cost reaches her browser.
    expect(invoices.length, "her invoices").toBeGreaterThan(0);
    expect(invoices.filter((invoice) => "cost" in invoice).length, "invoices carrying cost").toBe(0);
    const lines = invoices.flatMap((invoice) => invoice.lines);
    expect(lines.filter((line) => "unitCost" in line).length, "invoice lines carrying unitCost").toBe(0);

    // The loader: its monthlyPnl meets her withheld costs over the last 12 months.
    const live = invoices.filter((invoice) => !invoice.voidedAt);
    expect(
      live.some((invoice) => invoice.issuedAt >= addDays(companyToday(), -330)),
      "her answer has an invoice in the last 12 months, so the loader's monthlyPnl meets a withheld cost; " +
        "the API seed keeps the fixture dates (to 2026-11-04)",
    ).toBe(true);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    const panel = page.getByRole("region", { name: "Your revenue, last 12 months" });
    await expect(panel).toBeVisible();
    await expect(failures(page)).toHaveCount(0);

    // A window that holds her invoices, taken from her answer: the calendar has moved past the seed.
    const to = live
      .map((invoice) => invoice.issuedAt)
      .sort()
      .at(-1)!;
    const from = addDays(to, -29);
    const inWindow = invoicesIn(invoices, from, to);
    expect(
      inWindow.some((invoice) => invoice.lines.some((line) => line.category === "material" && line.productId)),
      "a product line in her last 30 days of invoices",
    ).toBe(true);

    // The figure cards: salesTotals over invoices without cost.
    const filters = page.getByRole("group", { name: "Dashboard filters" });
    await choose(page, filters.getByLabel("Period"), "Custom");
    await filters.getByLabel("From", { exact: true }).fill(from);
    await filters.getByLabel("To", { exact: true }).fill(to);
    const figures = page.locator("dl").filter({ hasText: "Payments received" });
    const revenueCard = figures.locator("div").filter({ has: page.locator("dt", { hasText: /^Revenue$/ }) });
    await expect(revenueCard).toContainText(
      formatNumber(salesTotals(inWindow).revenue, "money", defaultNumberSettings(), { compact: true }),
    );
    await expect(figures.getByText("Gross margin")).toHaveCount(0);
    await expect(failures(page)).toHaveCount(0);

    // Best sellers: bestSellersIn over lines without unitCost.
    const best = page.getByRole("region", { name: "Best sellers" });
    await choose(page, best.getByLabel("Best sellers period"), "Custom");
    await best.getByLabel("Best sellers from").fill(from);
    await best.getByLabel("Best sellers to").fill(to);
    await expect(best.getByRole("listitem").first()).toBeVisible();
    await expect(best.getByText("No sales in this period.")).toHaveCount(0);
    await expect(best.getByRole("button", { name: "Revenue", exact: true })).toBeVisible();
    await expect(best.getByRole("button", { name: "Margin", exact: true })).toHaveCount(0);
    await best.getByRole("button", { name: "Show best sellers as a table" }).click();
    await expect(best.getByRole("columnheader", { name: "Revenue", exact: true })).toBeVisible();
    await expect(best.getByRole("columnheader", { name: "Margin", exact: true })).toHaveCount(0);

    // The 12-month table: revenue only.
    await panel.getByRole("button", { name: "Show table" }).click();
    await expect(panel.getByRole("columnheader", { name: "Revenue", exact: true })).toBeVisible();
    await expect(panel.getByRole("row")).toHaveCount(13);
    await expect(panel.getByRole("columnheader", { name: "Gross margin" })).toHaveCount(0);

    await expect(page.getByText("Gross margin")).toHaveCount(0);
    await expect(failures(page)).toHaveCount(0);
  });

  test("a manager's dashboard shows gross margin from the API (B5)", async ({ page }) => {
    await signInAs(page, MANAGER_EMAIL);
    const answer = waitForAnswer<ViewedInvoice[]>(page, "GET", /^\/api-proxy\/invoices$/);
    await page.goto("/");
    const invoices = await answer;
    expect(invoices.length, "his invoices").toBeGreaterThan(0);
    expect(
      invoices.every((invoice) => "cost" in invoice),
      "Summit's ceiling and modules give the Manager product cost and contract cost",
    ).toBe(true);

    await expect(page.getByRole("heading", { name: "Revenue and gross margin, last 12 months" })).toBeVisible();
    await expect(page.getByText("Gross margin").first()).toBeVisible();
    const best = page.getByRole("region", { name: "Best sellers" });
    await expect(best.getByRole("button", { name: "Margin", exact: true })).toBeVisible();
    await expect(failures(page)).toHaveCount(0);
  });
});
