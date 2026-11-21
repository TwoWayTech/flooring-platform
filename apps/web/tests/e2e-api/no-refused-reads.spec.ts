import { expect, test, type Page } from "@playwright/test";
import type { Contract, Invoice, Quote } from "@workspace/shared";
import { SALES_EMAIL, signInAs } from "./accounts";
import { readAs } from "./flows/checks";

/** Every API request the page sent that the API refused with 403, as "METHOD path". */
function refusals(page: Page): string[] {
  const refused: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (response.status() === 403 && url.pathname.startsWith("/api-proxy/"))
      refused.push(`${response.request().method()} ${url.pathname.replace("/api-proxy", "")}`);
  });
  return refused;
}

/**
 * Click-through finding #28: as Sales (Priya), the dashboard, Contracts, a contract, Inventory, New
 * quote, a quote and an invoice asked for lists her role may not read (lien waivers, insurance,
 * suppliers, bills, supplier payments, transfers) and the API refused them. The screens now ask
 * only for what her effective permissions allow (ReadGate, the shared `mayReadList`), so normal
 * navigation sends no request the API refuses.
 */
test.describe("no refused reads for Sales (finding #28, api mode)", () => {
  test("Priya's pages send no request the API refuses", async ({ page }) => {
    const refused = refusals(page);
    await signInAs(page, SALES_EMAIL);
    const [contract] = await readAs<Contract[]>(page.request, "/contracts");
    const [quote] = await readAs<Quote[]>(page.request, "/quotes");
    const [invoice] = await readAs<Invoice[]>(page.request, "/invoices");
    const pages: [string, string][] = [
      ["/", "Dashboard"],
      ["/contracts", "Contracts"],
      ["/inventory", "Inventory"],
      ["/sales/quotes/new", "New quote"],
    ];
    if (contract) pages.push([`/contracts/${contract.id}`, contract.number]);
    if (quote) pages.push([`/sales/quotes/${quote.id}`, quote.number]);
    if (invoice) pages.push([`/sales/invoices/${invoice.id}`, invoice.number]);
    for (const [path, name] of pages) {
      await page.goto(path);
      await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
      await expect(page.getByText(name).first()).toBeVisible();
      await page.waitForLoadState("networkidle");
    }
    expect(refused).toEqual([]);
  });
});
