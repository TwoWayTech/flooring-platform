import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import { dec, moneyString, sameOptionalDecimal, type Customer, type Invoice, type Quote } from "@workspace/shared";
import { ACCOUNTANT_EMAIL, SALES_EMAIL } from "./accounts";
import { auditEntriesBy, confirmStepUp, putWithStepUp, readAs } from "./flows/checks";
import { addProduct, FIELDSTONE, flowTest, resetAuthAround, runId, waitForAnswer } from "./flows/kit";

const ACTION = "Changed localization and tax";
const PATH = "/settings/localization/tax";
const RATE_WORDS = "Enter the rate for Texas as a percent below 100 with up to 4 decimals, such as 8.25.";
const PRICES_WORDS = "Whether prices include sales tax can't be changed yet: documents add tax on top of prices.";
/** The issued Summit invoice whose tax the tab must never change (seeded, Colorado v1). */
const ISSUED = "INV-1004";

/**
 * Summit's seeded Texas rule content (`packages/shared/fixtures/summit.json`), as the restore puts it
 * back. Written out, not imported, so this spec builds on code without part 3a's shared rules. No
 * other e2e spec uses a Texas job site.
 */
const SUMMIT_TX = {
  jurisdiction: "Houston combined",
  ratePct: "8.25",
  taxable: { material: true, labor: false, freight: true, service: false },
  lumpSumLaborTaxable: false,
  rationale: "Residential hard-floor installation is a real-property improvement; labor is untaxed.",
};

/** What these tests read of the Sales tax tab, loosely, so the spec builds with or without part 3a's types. */
type TaxRuleRead = typeof SUMMIT_TX & {
  state: string;
  validFrom: string;
  validTo?: string | null;
  version: number;
};
type CountyRead = { id: string; state: string; county: string; name: string; ratePct: string; validFrom: string };
type TaxRead = { pricesInclude: string; rules: TaxRuleRead[]; jurisdictions: CountyRead[] } & Record<string, unknown>;

/** Summit's day: its control zone is America/Denver (`packages/db/src/seed/control.ts`). */
function summitDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** The Sales tax tab `GET /settings` answers the request's person; fails when it isn't answered. */
async function taxOf(request: APIRequestContext): Promise<TaxRead> {
  const answer = await readAs<{ localization?: { tax?: TaxRead } }>(request, "/settings");
  expect(answer.localization?.tax, "GET /settings answers localization.tax").toBeDefined();
  return answer.localization!.tax!;
}

/** The tax categories a rule's `taxable` holds, compared one by one: jsonb answers its keys in its own order. */
const CATEGORIES = Object.keys(SUMMIT_TX.taxable) as (keyof typeof SUMMIT_TX.taxable)[];

/** Whether Texas reads as seeded, by value, and no Harris county rate is in force. */
function healthy(tax: TaxRead): boolean {
  const texas = tax.rules.find((rule) => rule.state === "TX");
  return (
    !!texas &&
    texas.jurisdiction === SUMMIT_TX.jurisdiction &&
    sameOptionalDecimal(texas.ratePct, SUMMIT_TX.ratePct) &&
    CATEGORIES.every((category) => texas.taxable[category] === SUMMIT_TX.taxable[category]) &&
    texas.lumpSumLaborTaxable === SUMMIT_TX.lumpSumLaborTaxable &&
    texas.rationale === SUMMIT_TX.rationale &&
    !tax.jurisdictions.some((rate) => rate.county === "Harris")
  );
}

/**
 * Puts Summit's Texas rule back and drops any Harris county rate, unless `GET /settings` already
 * answers them so; each restore is a new Texas version (part 3a, R4). Returns the last answer.
 */
async function healTax(request: APIRequestContext, secret: string): Promise<APIResponse> {
  const read = await request.get("/api-proxy/settings");
  expect(read.status(), `GET /settings answered ${read.status()}: ${await read.text()}`).toBe(200);
  const tax = ((await read.json()) as { localization?: { tax?: TaxRead } }).localization?.tax;
  if (!tax) throw new Error("GET /settings answers no Sales tax tab");
  if (healthy(tax)) return read;
  const texas = tax.rules.find((rule) => rule.state === "TX");
  const rules = texas
    ? tax.rules.map((rule) => (rule.state === "TX" ? { ...rule, ...SUMMIT_TX } : rule))
    : [...tax.rules, { ...SUMMIT_TX, state: "TX", validFrom: summitDay(), validTo: null, version: 1 }];
  const jurisdictions = tax.jurisdictions.filter((rate) => rate.county !== "Harris");
  return putWithStepUp(request, secret, PATH, { ...tax, rules, jurisdictions });
}

/** `healTax` that throws unless the API answered 200, so a refused restore fails the clean-up. */
async function healTaxOrThrow(request: APIRequestContext, secret: string): Promise<APIResponse> {
  const response = await healTax(request, secret);
  if (response.status() !== 200)
    throw new Error(`Putting Sales tax back answered ${response.status()}: ${await response.text()}`);
  return response;
}

/** The PUTs a page sends to the Sales tax route, collected as they leave. */
function taxPuts(page: Page): string[] {
  const sent: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname === `/api-proxy${PATH}`) sent.push(request.url());
  });
  return sent;
}

/** What an issued invoice keeps of its tax. */
function taxKept(invoice: Invoice) {
  return { tax: invoice.tax, total: invoice.total, taxRule: invoice.taxRule };
}

/**
 * Settings part 3a on the API (ADR 0059; spec settings-and-permissions.md, Real build, "Settings on
 * the API, part 3a"): the Sales tax tab reads and saves through `GET /settings` and
 * `PUT /settings/localization/tax`; a refused rate says why before any code; a saved change is a new
 * version from Summit's day that a salesperson's new quote takes at once, while issued invoices keep
 * their tax; dates and the prices setting are read only. Each test heals Texas first, puts it back as
 * its last step, and registers a clean-up that repeats the restore and fails if the API refuses it.
 */
flowTest.describe("Settings part 3a on the API (api mode)", () => {
  // Each test signs Grace in with a new factor, so each resets sign-in state around itself (as part 2b's specs).
  flowTest.describe("the save", () => {
    resetAuthAround([ACCOUNTANT_EMAIL, SALES_EMAIL]);

    flowTest(
      "TE1 Sales tax on the API: a refused rate says why before any code, a saved Texas rate and county rate reach a salesperson's new quote, issued invoices keep their tax, and Sales can't change it",
      async ({ personas }) => {
        flowTest.setTimeout(240_000);
        const grace = await personas.open(ACCOUNTANT_EMAIL, { mfa: true });
        const priya = await personas.open(SALES_EMAIL);

        // 1. Clean-up first, then the heal; keep the ids of Grace's entries so only this test's are counted.
        personas.onCleanup("put Sales tax back", () => healTaxOrThrow(grace.request, grace.secret!));
        expect((await healTax(grace.request, grace.secret!)).status()).toBe(200);
        const since = Date.now();
        const seen = new Set(
          (await auditEntriesBy(grace.request, ACTION, "Grace Liu", since)).map((entry) => entry.id),
        );
        const before = await taxOf(grace.request);
        const texasBefore = before.rules.find((rule) => rule.state === "TX")!;
        const coloradoBefore = before.rules.find((rule) => rule.state === "CO")!;
        const issued = (await readAs<Invoice[]>(grace.request, "/invoices")).find((each) => each.number === ISSUED);
        expect(issued, `the seeded invoice ${ISSUED}`).toBeDefined();

        // 2. A refused rate: the page says why and sends nothing; the API says the same.
        const puts = taxPuts(grace.page);
        await grace.page.goto("/settings/localization?tab=tax");
        await grace.page.getByLabel("Texas rate in percent").fill("7.123456");
        await grace.page.getByRole("button", { name: "Save sales tax" }).click();
        const refused = grace.page.getByText(RATE_WORDS);
        await expect(refused).toBeVisible();
        await expect(grace.page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0);
        expect(puts).toEqual([]);
        await grace.page.mouse.move(0, 0);
        await expect(refused).toBeHidden();
        await grace.page
          .getByRole("region", { name: "Unsaved changes" })
          .getByRole("button", { name: "Discard" })
          .click();
        const direct = await grace.request.put(`/api-proxy${PATH}`, {
          data: {
            ...before,
            rules: before.rules.map((rule) => (rule.state === "TX" ? { ...rule, ratePct: "7.123456" } : rule)),
          },
        });
        expect(direct.status()).toBe(400);
        expect(await direct.json()).toMatchObject({ code: "invalid_request", message: RATE_WORDS });

        // 3. Texas at 7.75 and a Harris county rate at 8.5 (the new row is "county rate 4" until it has a name).
        await grace.page.getByLabel("Texas rate in percent").fill("7.75");
        await grace.page.getByRole("button", { name: "Add a county rate" }).click();
        const row = `county rate ${before.jurisdictions.length + 1}`;
        await grace.page.getByLabel(`${row} state`).click();
        await grace.page.getByRole("option", { name: "Texas", exact: true }).click();
        await grace.page.getByLabel(`${row} county`).fill("Harris");
        await grace.page.getByLabel(`${row} rate in percent`).fill("8.5");
        await grace.page.getByLabel(`${row} name`).fill("Harris County combined");
        const saved = grace.page.waitForResponse(
          (response) =>
            response.request().method() === "PUT" && new URL(response.url()).pathname === `/api-proxy${PATH}`,
        );
        await grace.page.getByRole("button", { name: "Save sales tax" }).click();
        await expect(grace.page.getByRole("dialog", { name: "Confirm it is you" })).toBeVisible();
        await confirmStepUp(grace.page, grace.secret!);
        expect((await saved).status()).toBe(200);
        await expect(grace.page.getByText("Sales tax saved")).toBeVisible();

        // 4. The form shows what the save stored (it remounts, D27); the API answers the new version.
        const day = summitDay();
        await expect(grace.page.getByLabel("Texas valid from")).toHaveValue(day);
        expect(sameOptionalDecimal(await grace.page.getByLabel("Texas rate in percent").inputValue(), "7.75")).toBe(
          true,
        );
        const after = await taxOf(grace.request);
        const texas = after.rules.find((rule) => rule.state === "TX")!;
        expect(sameOptionalDecimal(texas.ratePct, "7.75")).toBe(true);
        expect([texas.validFrom, texas.version]).toEqual([day, texasBefore.version + 1]);
        const harris = after.jurisdictions.find((rate) => rate.county === "Harris")!;
        expect([harris.state, harris.validFrom, sameOptionalDecimal(harris.ratePct, "8.5")]).toEqual(["TX", day, true]);
        expect(harris.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/);
        const colorado = after.rules.find((rule) => rule.state === "CO")!;
        expect([colorado.version, colorado.validFrom]).toEqual([coloradoBefore.version, coloradoBefore.validFrom]);
        const mine = (await auditEntriesBy(grace.request, ACTION, "Grace Liu", since)).filter(
          (entry) => !seen.has(entry.id),
        );
        expect(mine.map((entry) => entry.target)).toEqual(["Sales tax"]);

        // 5. Priya reads the same rule, and her new quote takes it: the state's rate, then Harris County's.
        const hers = await taxOf(priya.request);
        expect(hers.rules.find((rule) => rule.state === "TX")).toEqual(texas);
        const { page } = priya;
        const customerName = `E2E Tax Customer ${runId()}`;
        await page.goto("/sales/quotes/new");
        await page.getByLabel("Fulfilled from").click();
        await page.getByRole("option", { name: "Denver Central", exact: true }).click();
        await page.getByLabel("Customer", { exact: true }).click();
        await page.getByLabel("Search customers").fill(customerName);
        await page.getByRole("option", { name: `Add “${customerName}” as a new customer` }).click();
        const added = waitForAnswer<Customer>(page, "POST", /^\/api-proxy\/customers$/);
        await page.getByRole("form", { name: "New customer" }).getByRole("button", { name: "Add customer" }).click();
        await added;
        await expect(page.getByLabel("Customer", { exact: true })).toHaveText(customerName);
        const site = async (label: string, value: string) => {
          const field = page.getByLabel(label, { exact: true });
          await field.fill(value);
          await field.blur();
        };
        await site("Job site street", "1 Main St");
        await site("City", "Houston");
        await page.locator("#site-state").click();
        await page.getByRole("option", { name: "Texas", exact: true }).click();
        await site("ZIP", "77002");
        await addProduct(page, FIELDSTONE);
        const quantity = page.getByLabel(`${FIELDSTONE.line} quantity`, { exact: true });
        await quantity.fill("15");
        await quantity.blur();
        await expect(quantity).toHaveValue("15");
        await expect(page.getByText(/Default rate for Texas \(example\)/)).toBeVisible();
        await site("County", "Harris");
        await expect(page.getByText(/Harris County combined rate \(example\)/)).toBeVisible();
        const drafted = waitForAnswer<Quote>(page, "POST", /^\/api-proxy\/quotes$/);
        const request = page.waitForRequest(
          (each) => each.method() === "POST" && new URL(each.url()).pathname === "/api-proxy/quotes",
        );
        await page.getByRole("button", { name: "Save as draft" }).click();
        const quote = await drafted;
        // The same quote where nothing is collected (Montana, not a state of operation) is its subtotal.
        const body = (await request).postDataJSON() as { jobSite: Record<string, unknown> };
        const untaxed = await priya.request.post("/api-proxy/quotes", {
          data: { ...body, jobSite: { ...body.jobSite, state: "MT", county: "", city: "Helena", zip: "59601" } },
        });
        expect(untaxed.status(), await untaxed.text()).toBe(201);
        const subtotal = ((await untaxed.json()) as Quote).total;
        expect(quote.total).toBe(moneyString(dec(subtotal).plus(dec(subtotal).times("8.5").dividedBy(100))));

        // 6. The issued invoice keeps its tax.
        const kept = (await readAs<Invoice[]>(grace.request, "/invoices")).find((each) => each.number === ISSUED)!;
        expect(taxKept(kept)).toEqual(taxKept(issued!));

        // 7. Sales can't change it.
        const denied = await priya.request.put(`/api-proxy${PATH}`, { data: after });
        expect(denied.status()).toBe(403);
        expect((await denied.json()).code).toBe("forbidden");
        await page.goto("/settings/localization");
        await expect(page.getByText("You don't have access to this page.")).toBeVisible();

        // 8. Put back.
        expect((await healTaxOrThrow(grace.request, grace.secret!)).status()).toBe(200);
        const restored = await taxOf(grace.request);
        expect(healthy(restored)).toBe(true);
      },
    );
  });

  flowTest.describe("read only", () => {
    resetAuthAround([ACCOUNTANT_EMAIL]);

    flowTest(
      "TE2 The tab shows its dates and the prices setting read only, and the API refuses turning on tax-inclusive prices",
      async ({ personas }) => {
        flowTest.setTimeout(120_000);
        const grace = await personas.open(ACCOUNTANT_EMAIL, { mfa: true });
        personas.onCleanup("put Sales tax back", () => healTaxOrThrow(grace.request, grace.secret!));
        expect((await healTax(grace.request, grace.secret!)).status()).toBe(200);
        const before = await taxOf(grace.request);

        const { page } = grace;
        await page.goto("/settings/localization?tab=tax");
        await expect(page.getByLabel("Texas valid from")).toBeDisabled();
        await expect(page.getByLabel("Company default rate valid from")).toBeDisabled();
        const dates = page.getByLabel(/ valid (from|to)$/);
        expect(await dates.count()).toBeGreaterThan(before.rules.length);
        for (const input of await dates.all()) await expect(input).toBeDisabled();
        const prices = page.getByLabel("Prices are");
        await expect(prices).toBeDisabled();
        await expect(prices).toHaveValue("Before tax (tax added on top)");

        const inclusive = await putWithStepUp(grace.request, grace.secret!, PATH, {
          ...before,
          pricesInclude: "inclusive",
        });
        expect(inclusive.status()).toBe(400);
        expect(await inclusive.json()).toMatchObject({ code: "invalid_request", message: PRICES_WORDS });
        const backDated = await putWithStepUp(grace.request, grace.secret!, PATH, {
          ...before,
          rules: before.rules.map((rule) => (rule.state === "TX" ? { ...rule, validFrom: "2020-01-01" } : rule)),
        });
        expect(backDated.status(), await backDated.text()).toBe(200);
        const texas = (await taxOf(grace.request)).rules.find((rule) => rule.state === "TX")!;
        const texasBefore = before.rules.find((rule) => rule.state === "TX")!;
        expect([texas.version, texas.validFrom]).toEqual([texasBefore.version, texasBefore.validFrom]);
      },
    );
  });
});
