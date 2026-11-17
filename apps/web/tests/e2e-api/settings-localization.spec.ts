import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { californiaPayOn, dec, type Invoice, type Quote, type SettingsAnswer } from "@workspace/shared";
import { ACCOUNTANT_EMAIL, HR_EMAIL, OWNER_EMAIL, SALES_EMAIL } from "./accounts";
import { auditBy, auditEntriesBy, canonical, readAs } from "./flows/checks";
import { addProduct, choose, FIELDSTONE, flowTest, resetAuthAround, runId, waitForAnswer } from "./flows/kit";

/**
 * Summit's seeded Sales and documents and Payroll rules (docs/product-spec/settings-and-permissions.md,
 * "CompanySettings"; the fixture `packages/shared/fixtures/summit.json`), as
 * `PUT /settings/localization/<tab>` takes them back. Written out, not imported, so this spec builds
 * on code without the shared localization rules.
 */
const SUMMIT_DOCUMENTS = {
  defaultTerms: "due_on_receipt",
  lateFeePct: "1.5",
  quotePrefix: "Q-",
  invoicePrefix: "INV-",
  poPrefix: "PO-",
  legalFooter: "Summit Floor Company LLC. Licensed and insured in CO, WY.",
  defaultDepositPct: "50",
  quoteExpiryDays: 30,
  balanceDueDays: 30,
  defaultWastePct: {
    carpet: "12",
    carpet_tile: "8",
    lvp: "8",
    laminate: "8",
    engineered_hardwood: "8",
    solid_hardwood: "8",
    porcelain_tile: "10",
    pad: "8",
    adhesive_trim: "8",
  },
};
const SUMMIT_PAYROLL = { overtimeRule: "federal", holidayState: "CO" };
const ACTION = "Changed localization and tax";
const LATE_FEE_MESSAGE = "Enter the late fee per month as a percent such as 1.5, from 0 to 100.";
const CALIFORNIA_MESSAGE = "California pay rules are switched off until a payroll review. Choose the federal rule.";

type Tab = "documents" | "payroll";

/**
 * Puts one localization tab back to `value` unless `GET /settings` already answers it, through
 * `PUT /settings/localization/<tab>`. Returns the last answer, the read when nothing needed changing.
 */
async function healTab(request: APIRequestContext, tab: Tab, value: object): Promise<APIResponse> {
  const read = await request.get("/api-proxy/settings");
  expect(read.status(), `GET /settings answered ${read.status()}: ${await read.text()}`).toBe(200);
  const answer = (await read.json()) as SettingsAnswer;
  if (canonical(answer.localization?.[tab]) === canonical(value)) return read;
  return request.put(`/api-proxy/settings/localization/${tab}`, { data: value });
}

/** `healTab` that throws unless the API answered 200, so a refused restore fails the clean-up. */
async function healTabOrThrow(request: APIRequestContext, tab: Tab, value: object): Promise<APIResponse> {
  const response = await healTab(request, tab, value);
  if (response.status() !== 200)
    throw new Error(`Putting ${tab} back answered ${response.status()}: ${await response.text()}`);
  return response;
}

/** The targets of the audit entries `actor` made with ACTION from `since`'s minute on. */
async function targetsBy(request: APIRequestContext, actor: string, since: number): Promise<string[]> {
  return (await auditEntriesBy(request, ACTION, actor, since)).map((entry) => entry.target);
}

/**
 * Settings part 2a on the API (ADR 0059; spec settings-and-permissions.md, Real build, "Settings on
 * the API, part 2a"): Sales and documents and the Payroll rules tab read and save through
 * `GET /settings` and `PUT /settings/localization/<tab>`, the screens that read them follow, and what
 * a role isn't offered the API refuses. Region still saves in the browser. Each test heals what it
 * changes first, puts it back as its last step, and registers a clean-up that repeats the restore
 * and fails if the API refuses it.
 */
flowTest.describe("Settings part 2a on the API (api mode)", () => {
  flowTest.describe("Sales and documents", () => {
    resetAuthAround([ACCOUNTANT_EMAIL, SALES_EMAIL]);

    flowTest(
      "E1 Sales and documents on the API: a refused save says why; a new quote starts with the saved deposit and waste, which the server accepts from Sales; the invoice prints the new footer; Sales can't change it",
      async ({ personas }) => {
        flowTest.setTimeout(120_000);
        const grace = await personas.open(ACCOUNTANT_EMAIL, { mfa: true });
        const priya = await personas.open(SALES_EMAIL);
        personas.onCleanup("put Sales and documents back", () =>
          healTabOrThrow(grace.request, "documents", SUMMIT_DOCUMENTS),
        );
        expect((await healTab(grace.request, "documents", SUMMIT_DOCUMENTS)).status()).toBe(200);
        const since = Date.now();
        const audited = await auditBy(grace.request, ACTION, "Grace Liu", since);
        const run = runId();
        const footer = `e2e-${run} Summit Floor Company LLC.`;
        const documentsPut = () =>
          grace.page.waitForResponse(
            (response) =>
              response.request().method() === "PUT" &&
              new URL(response.url()).pathname === "/api-proxy/settings/localization/documents",
          );

        // 1. A refused late fee: the API's words in a toast, and the draft stays.
        await grace.page.goto("/settings/documents");
        await grace.page.getByLabel("Late fee per month").fill("12.");
        const refused = documentsPut();
        await grace.page.getByRole("button", { name: "Save documents" }).click();
        expect((await refused).status()).toBe(400);
        await expect(grace.page.getByText(LATE_FEE_MESSAGE)).toBeVisible();
        const bar = grace.page.getByRole("region", { name: "Unsaved changes" });
        await expect(bar).toContainText("1 unsaved change");
        await bar.getByRole("button", { name: "Discard" }).click();

        // 2. The save: a 40 % deposit, 13 % carpet waste and a footer of this run.
        await grace.page.getByLabel("Default deposit on quotes").fill("40");
        await grace.page.getByLabel("Waste for Carpet").fill("13");
        await grace.page.getByLabel("Legal footer").fill(footer);
        const saved = documentsPut();
        await grace.page.getByRole("button", { name: "Save documents" }).click();
        expect((await saved).status()).toBe(200);
        await expect(grace.page.getByText("Documents saved")).toBeVisible();
        const stored = (await readAs<SettingsAnswer>(grace.request, "/settings")).localization?.documents;
        expect(stored).toMatchObject({ defaultDepositPct: "40", legalFooter: footer });
        expect(stored?.defaultWastePct.carpet).toBe("13");

        // 3. Priya's new quote starts from the server's deposit and carpet waste, which the server
        //    accepts from someone without sales.waste.view (STATUS B6).
        const customerName = `E2E Docs ${run}`;
        await priya.page.goto("/sales/quotes/new");
        await priya.page.getByLabel("Fulfilled from").click();
        await priya.page.getByRole("option", { name: "Denver Central", exact: true }).click();
        await priya.page.getByLabel("Customer", { exact: true }).click();
        await priya.page.getByLabel("Search customers").fill(customerName);
        await priya.page.getByRole("option", { name: `Add “${customerName}” as a new customer` }).click();
        const added = waitForAnswer(priya.page, "POST", /^\/api-proxy\/customers$/);
        await priya.page
          .getByRole("form", { name: "New customer" })
          .getByRole("button", { name: "Add customer" })
          .click();
        await added;
        await expect(priya.page.getByLabel("Customer", { exact: true })).toHaveText(customerName);
        await addProduct(priya.page, FIELDSTONE);
        const posted = priya.page.waitForResponse(
          (response) =>
            response.request().method() === "POST" && new URL(response.url()).pathname === "/api-proxy/quotes",
        );
        const drafted = waitForAnswer<Quote>(priya.page, "POST", /^\/api-proxy\/quotes$/);
        await priya.page.getByRole("button", { name: "Save as draft" }).click();
        expect((await posted).status(), "the builder's new line carries the server's waste default").toBe(201);
        const quote = await drafted;
        expect(dec(quote.depositPct).eq(40)).toBe(true);
        const line = quote.lines.find((candidate) => candidate.description === FIELDSTONE.line);
        expect(line, "the Fieldstone line").toBeDefined();
        expect(dec(line!.wastePct ?? "0").eq(13)).toBe(true);
        const priyas = await readAs<SettingsAnswer>(priya.request, "/settings");
        expect(priyas.localization?.documents?.defaultWastePct.carpet).toBe("13");
        expect(priyas.localization ?? {}).not.toHaveProperty("region");

        // 4. The invoice prints the new footer.
        const invoice = (await readAs<Invoice[]>(grace.request, "/invoices")).find((each) => each.voidedAt === null);
        expect(invoice, "a Summit invoice that isn't void").toBeDefined();
        await grace.page.goto(`/sales/invoices/${invoice!.id}`);
        await expect(grace.page.getByRole("article").first()).toContainText(footer);

        // 5. What Sales isn't offered, the API refuses.
        const denied = await priya.request.put("/api-proxy/settings/localization/documents", {
          data: SUMMIT_DOCUMENTS,
        });
        expect(denied.status()).toBe(403);
        expect((await denied.json()).code).toBe("forbidden");
        await priya.page.goto("/settings");
        await expect(priya.page.getByRole("link", { name: "Sales and documents" })).toHaveCount(0);

        // 6. Put back; Priya reads Summit's documents again.
        expect((await healTabOrThrow(grace.request, "documents", SUMMIT_DOCUMENTS)).status()).toBe(200);
        const back = (await readAs<SettingsAnswer>(priya.request, "/settings")).localization?.documents;
        expect(canonical(back)).toBe(canonical(SUMMIT_DOCUMENTS));

        // 7. Two saves audited as Grace, each naming the tab: step 2 and the restore; step 1 wrote none.
        expect(await auditBy(grace.request, ACTION, "Grace Liu", since)).toBe(audited + 2);
        expect(new Set(await targetsBy(grace.request, "Grace Liu", since))).toEqual(new Set(["Sales and documents"]));
      },
    );
  });

  flowTest.describe("Payroll rules", () => {
    resetAuthAround([OWNER_EMAIL, HR_EMAIL]);

    flowTest(
      "E2 Payroll rules on the API; California is refused while its switch is off; HR without the key is refused; Region still saves in the browser",
      async ({ personas }) => {
        flowTest.setTimeout(120_000);
        const dana = await personas.open(OWNER_EMAIL, { mfa: true });
        const tamara = await personas.open(HR_EMAIL, { mfa: true });
        personas.onCleanup("put Payroll rules back", () => healTabOrThrow(dana.request, "payroll", SUMMIT_PAYROLL));
        expect((await healTab(dana.request, "payroll", SUMMIT_PAYROLL)).status()).toBe(200);
        const since = Date.now();
        const audited = await auditBy(dana.request, ACTION, "Dana Whitfield", since);

        // 1. Dana saves Wyoming's holidays; after a reload the tab reads them from the API.
        await dana.page.goto("/settings/localization?tab=payroll");
        await choose(dana.page, dana.page.getByLabel("Holiday calendar"), "Wyoming");
        const saved = dana.page.waitForResponse(
          (response) =>
            response.request().method() === "PUT" &&
            new URL(response.url()).pathname === "/api-proxy/settings/localization/payroll",
        );
        await dana.page.getByRole("button", { name: "Save payroll rules" }).click();
        expect((await saved).status()).toBe(200);
        await expect(dana.page.getByText("Payroll rules saved")).toBeVisible();
        await dana.page.reload();
        await expect(dana.page.getByLabel("Holiday calendar")).toContainText("Wyoming");

        // 2. The California rule is refused while its switch is off (ADR 0050), whatever the screen offers.
        if (!californiaPayOn()) {
          const california = await dana.request.put("/api-proxy/settings/localization/payroll", {
            data: { overtimeRule: "california", holidayState: "CO" },
          });
          expect(california.status()).toBe(400);
          expect(await california.json()).toMatchObject({ code: "invalid_request", message: CALIFORNIA_MESSAGE });
        } else {
          flowTest.info().annotations.push({ type: "skip-step", description: "California pay rules are on" });
        }

        // 3. Tamara reads the payroll rule (timesheets) but not the documents, and can't save it.
        const denied = await tamara.request.put("/api-proxy/settings/localization/payroll", { data: SUMMIT_PAYROLL });
        expect(denied.status()).toBe(403);
        expect((await denied.json()).code).toBe("forbidden");
        const hers = (await readAs<SettingsAnswer>(tamara.request, "/settings")).localization;
        expect(hers?.payroll?.holidayState).toBe("WY");
        expect(hers ?? {}).not.toHaveProperty("documents");

        // 4. Region still saves in the browser in part 2a: nothing is sent to the API.
        const sent: string[] = [];
        dana.page.on("request", (request) => {
          const path = new URL(request.url()).pathname;
          if (path.startsWith("/api-proxy/settings/localization/")) sent.push(`${request.method()} ${path}`);
        });
        await dana.page.goto("/settings/localization?tab=region");
        await dana.page.getByLabel("Date format").click();
        await dana.page.getByRole("option", { name: /^\d{4}-\d{2}-\d{2}$/ }).click();
        await dana.page.getByRole("button", { name: "Save region" }).click();
        await expect(dana.page.getByText("Region saved")).toBeVisible();
        expect(sent).toEqual([]);

        // 5. Put back; two saves audited as Dana, each naming the tab.
        expect((await healTabOrThrow(dana.request, "payroll", SUMMIT_PAYROLL)).status()).toBe(200);
        expect(await auditBy(dana.request, ACTION, "Dana Whitfield", since)).toBe(audited + 2);
        expect(new Set(await targetsBy(dana.request, "Dana Whitfield", since))).toEqual(new Set(["Payroll rules"]));
      },
    );
  });
});
