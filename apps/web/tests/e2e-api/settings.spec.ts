import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import {
  dec,
  invoiceLedger,
  type AuditEntry,
  type Invoice,
  type InvoiceAdjustment,
  type Payment,
  type SettingsAnswer,
} from "@workspace/shared";
import { ACCOUNTANT_EMAIL, OWNER_EMAIL, SALES_EMAIL } from "./accounts";
import { cellUnder, confirmStepUp, expectAuditRows, putWithStepUp, readAs } from "./flows/checks";
import { companyToday, flowTest, resetAuthAround, runId, waitForAnswer } from "./flows/kit";

/**
 * Summit's seeded settings (docs/product-spec/settings-and-permissions.md, "CompanySettings"; the
 * fixture `packages/shared/fixtures/summit.json`), as `PUT /settings/<section>` takes them back.
 * Written out, not imported, so this spec builds on code without the shared settings module.
 */
const SUMMIT_PAYMENTS = {
  approvalRequired: true,
  approvalThreshold: "1000.00",
  writeOffMax: "5.00",
  paymentPrefix: "PAY-",
  refundPrefix: "RF-",
};
const SUMMIT_EXPENSES = { approvalRequired: true, approvalThreshold: "1000.00" };
const SUMMIT_NUMBERS_WIRE = {
  decimals: [
    { kind: "money", places: 2 },
    { kind: "unitCost", places: 4 },
    { kind: "quantity", places: 2 },
    { kind: "count", places: 0 },
    { kind: "percent", places: 1 },
    { kind: "taxRate", places: 3 },
    { kind: "fxRate", places: 4 },
  ],
  negativeStyle: "minus",
  compactDashboards: true,
  locale: "en-US",
  currency: "USD",
};
const SUMMIT_EMAIL = "office@summitfloor.example";
const PAYMENT_APPROVAL_MESSAGE = "Enter the payment approval amount as a number such as 1000.00, or leave it empty.";

type Served = "profile" | "numbers" | "payments" | "expenses";

/** A JSON value with its object keys sorted, so two answers compare whatever order jsonb kept. */
function canonical(value: unknown): string {
  const sorted = (inner: unknown): unknown =>
    Array.isArray(inner)
      ? inner.map(sorted)
      : inner && typeof inner === "object"
        ? Object.fromEntries(
            Object.entries(inner)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, item]) => [key, sorted(item)]),
          )
        : inner;
  return JSON.stringify(sorted(value));
}

/**
 * Puts one settings section back to `value` unless `GET /settings` already answers it: a PUT, with
 * a step-up for Payments. Returns the last answer, the read when nothing needed changing.
 */
async function healSection(
  request: APIRequestContext,
  section: Served,
  value: object,
  secret?: string,
): Promise<APIResponse> {
  const read = await request.get("/api-proxy/settings");
  expect(read.status(), `GET /settings answered ${read.status()}: ${await read.text()}`).toBe(200);
  const answer = (await read.json()) as SettingsAnswer;
  if (canonical(answer[section]) === canonical(value)) return read;
  const path = `/settings/${section}`;
  return secret ? putWithStepUp(request, secret, path, value) : request.put(`/api-proxy${path}`, { data: value });
}

/** `healSection` that throws unless the API answered 200, so a refused restore fails the clean-up. */
async function healOrThrow(
  request: APIRequestContext,
  section: Served,
  value: object,
  secret?: string,
): Promise<APIResponse> {
  const response = await healSection(request, section, value, secret);
  if (response.status() !== 200)
    throw new Error(`Putting ${section} back answered ${response.status()}: ${await response.text()}`);
  return response;
}

/** How many audit entries `actor` made with `action` from `since`'s minute on (the log keeps minutes). */
async function auditBy(request: APIRequestContext, action: string, actor: string, since: number): Promise<number> {
  const from = Math.floor(since / 60_000) * 60_000;
  const entries = await readAs<AuditEntry[]>(request, "/audit");
  return entries.filter(
    (entry) => entry.action === action && entry.actorName === actor && Date.parse(`${entry.at}:00Z`) >= from,
  ).length;
}

/** The first invoice in `invoices` with a Total of at least 1.00, or a failure that says none was found. */
function withTotal(invoices: readonly Invoice[], whose: string): Invoice {
  const found = invoices.find((invoice) => dec(invoice.total).gte(1));
  expect(found, `${whose} has an invoice with a Total of at least 1.00 to check the number format on`).toBeDefined();
  return found!;
}

/** The Total cell of invoice `number` on the open invoices list, after searching for it. */
async function totalOf(page: Page, number: string) {
  await page.getByPlaceholder("Search invoices and customers").fill(number);
  await expect(page).toHaveURL(new RegExp(number));
  return cellUnder(page.getByRole("table").first(), page.getByRole("row", { name: new RegExp(number) }), "Total");
}

/**
 * Settings part 1 on the API (ADR 0059; spec settings-and-permissions.md, Real build, "Settings on
 * the API, part 1"): the number format, payments, company profile and expense approval read and
 * save through `GET /settings` and `PUT /settings/<section>`, the screens follow, and what a role
 * isn't offered the API refuses. Each test heals what it changes first, puts it back as its last
 * step, and registers a clean-up that repeats the restore and fails if the API refuses it.
 */
flowTest.describe("Settings part 1 on the API (api mode)", () => {
  flowTest.describe("number format", () => {
    resetAuthAround([ACCOUNTANT_EMAIL, SALES_EMAIL]);

    flowTest(
      "E1 Number format saved on the API: the saver's screens follow at once, another person's on load, and Sales can't change it",
      async ({ personas }) => {
        flowTest.setTimeout(120_000);
        const grace = await personas.open(ACCOUNTANT_EMAIL, { mfa: true });
        const priya = await personas.open(SALES_EMAIL);
        personas.onCleanup("put the number format back", () =>
          healOrThrow(grace.request, "numbers", SUMMIT_NUMBERS_WIRE),
        );
        expect((await healSection(grace.request, "numbers", SUMMIT_NUMBERS_WIRE)).status()).toBe(200);
        const since = Date.now();
        const gx = withTotal(await readAs<Invoice[]>(grace.request, "/invoices"), "Grace");
        const px = withTotal(await readAs<Invoice[]>(priya.request, "/invoices"), "Priya");

        // 1. Grace's invoices list shows cents.
        await grace.page.goto("/sales?view=invoices");
        await expect(await totalOf(grace.page, gx.number)).toHaveText(/\.\d{2}$/);

        // 2. She saves money with no decimals.
        await grace.page.goto("/settings/number-format");
        const fewer = grace.page.getByRole("button", { name: "Fewer decimals for Money (prices, totals, balances)" });
        await fewer.click();
        await fewer.click();
        const saved = grace.page.waitForResponse(
          (response) =>
            response.request().method() === "PUT" && new URL(response.url()).pathname === "/api-proxy/settings/numbers",
        );
        await grace.page.getByRole("button", { name: "Save number format" }).click();
        expect((await saved).status()).toBe(200);
        await expect(grace.page.getByText("Number format saved")).toBeVisible();

        // 3. Her own screens follow without a reload: back to Sales through the main navigation.
        await grace.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Sales" }).click();
        await grace.page.getByRole("tab", { name: "Invoices" }).click();
        await expect(await totalOf(grace.page, gx.number)).toHaveText(/^\$[\d,]+$/);

        // 4. Priya's next load reads the API's number format; she gets no expense approval.
        const answer = waitForAnswer<SettingsAnswer>(priya.page, "GET", /^\/api-proxy\/settings$/);
        await priya.page.goto("/sales?view=invoices");
        await expect(await totalOf(priya.page, px.number)).toHaveText(/^\$[\d,]+$/);
        const read = await answer;
        expect(read.numbers?.decimals.find((entry) => entry.kind === "money")?.places).toBe(0);
        expect(read).not.toHaveProperty("expenses");

        // 5. What Sales isn't offered, the API refuses.
        const refused = await priya.request.put("/api-proxy/settings/numbers", { data: SUMMIT_NUMBERS_WIRE });
        expect(refused.status()).toBe(403);
        expect((await refused.json()).code).toBe("forbidden");
        await priya.page.goto("/settings");
        await expect(priya.page.getByRole("link", { name: "Number format" })).toHaveCount(0);

        // 6. Audited, as Grace.
        expect(await auditBy(grace.request, "Changed number format", "Grace Liu", since)).toBeGreaterThanOrEqual(1);
        await expectAuditRows(grace.page, "Number format", ["Changed number format"], since);

        // 7. Put back; Priya's list shows cents again.
        expect((await healOrThrow(grace.request, "numbers", SUMMIT_NUMBERS_WIRE)).status()).toBe(200);
        await priya.page.goto("/sales?view=invoices");
        await expect(await totalOf(priya.page, px.number)).toHaveText(/\.\d{2}$/);
      },
    );
  });

  flowTest.describe("payments", () => {
    resetAuthAround([ACCOUNTANT_EMAIL, OWNER_EMAIL, SALES_EMAIL]);

    flowTest(
      "E2 Payments: a refused save says why; the Accountant's change needs a step-up, reaches the server, and the Owner's buttons follow",
      async ({ personas }) => {
        flowTest.setTimeout(180_000);
        const grace = await personas.open(ACCOUNTANT_EMAIL, { mfa: true });
        const dana = await personas.open(OWNER_EMAIL, { mfa: true });
        const priya = await personas.open(SALES_EMAIL);
        const secret = grace.secret!;
        personas.onCleanup("put the payment rules back", () =>
          healOrThrow(grace.request, "payments", SUMMIT_PAYMENTS, secret),
        );
        expect((await healSection(grace.request, "payments", SUMMIT_PAYMENTS, secret)).status()).toBe(200);
        const since = Date.now();
        const audited = await auditBy(grace.request, "Changed payments", "Grace Liu", since);

        // 0. An open invoice with a balance over the seeded write-off limit.
        const [invoices, payments, adjustments] = await Promise.all([
          readAs<Invoice[]>(dana.request, "/invoices"),
          readAs<Payment[]>(dana.request, "/payments"),
          readAs<InvoiceAdjustment[]>(dana.request, "/invoice-adjustments"),
        ]);
        const today = companyToday();
        const open = invoices
          .map((invoice) => ({ invoice, ledger: invoiceLedger(invoice, { payments, adjustments }, today) }))
          .find(({ ledger }) => ledger.state !== "void" && ledger.state !== "return" && dec(ledger.balance).gt("5.00"));
        expect(open, "an open Summit invoice with a balance over 5.00").toBeDefined();
        const { invoice, ledger } = open!;
        const writeOff = dana.page.getByRole("menuitem", { name: "Write off remaining balance" });

        // 1. Dana is offered no write-off.
        await dana.page.goto(`/sales/invoices/${invoice.id}`);
        await dana.page.getByRole("button", { name: "Update status" }).click();
        await expect(dana.page.getByRole("menu")).toBeVisible();
        await expect(writeOff).toHaveCount(0);
        await dana.page.keyboard.press("Escape");

        // 2. A refused amount: the step-up, then the API's words; the draft stays.
        await grace.page.goto("/settings/payments");
        await grace.page.getByLabel("Only above this amount").fill("12.");
        const refusedPut = grace.page.waitForResponse(
          (response) =>
            response.request().method() === "PUT" &&
            new URL(response.url()).pathname === "/api-proxy/settings/payments",
        );
        await grace.page.getByRole("button", { name: "Save payments" }).click();
        await confirmStepUp(grace.page, secret);
        expect((await refusedPut).status()).toBe(400);
        await expect(grace.page.getByText(PAYMENT_APPROVAL_MESSAGE)).toBeVisible();
        await expect(grace.page.getByRole("dialog", { name: "Confirm it is you" })).toBeHidden();
        await expect(grace.page.getByText("1 unsaved change")).toBeVisible();

        // 3. Payments above 1.00 wait, and the write-off limit covers the invoice's balance.
        await grace.page.getByLabel("Only above this amount").fill("1.00");
        await grace.page.getByLabel("Largest write-off").fill(ledger.balance);
        const savedPut = grace.page.waitForResponse(
          (response) =>
            response.request().method() === "PUT" &&
            new URL(response.url()).pathname === "/api-proxy/settings/payments",
        );
        await grace.page.getByRole("button", { name: "Save payments" }).click();
        await confirmStepUp(grace.page, secret);
        expect((await savedPut).status()).toBe(200);
        await expect(grace.page.getByText("Payments saved")).toBeVisible();

        // 4. Dana's invoice follows the server's rules.
        await dana.page.reload();
        await dana.page.getByRole("button", { name: "Update status" }).click();
        await expect(writeOff).toBeVisible();
        await dana.page.keyboard.press("Escape");
        await dana.page.getByRole("button", { name: "Record payment", exact: true }).click();
        const sheet = dana.page.getByRole("dialog", { name: "Record payment" });
        await sheet.getByLabel("Amount", { exact: true }).fill("2.00");
        await expect(sheet.getByText("Status after").locator("..")).toContainText("Pending verification");
        await expect(sheet.getByText(/above \$1\.00 wait for a second person/)).toBeVisible();
        await dana.page.keyboard.press("Escape");
        await expect(sheet).toBeHidden();

        // 5. What Sales isn't offered, the API refuses.
        const refused = await priya.request.put("/api-proxy/settings/payments", { data: SUMMIT_PAYMENTS });
        expect(refused.status()).toBe(403);
        expect((await refused.json()).code).toBe("forbidden");

        // 6. Put back; Dana is offered no write-off again.
        expect((await healOrThrow(grace.request, "payments", SUMMIT_PAYMENTS, secret)).status()).toBe(200);
        await dana.page.reload();
        await dana.page.getByRole("button", { name: "Update status" }).click();
        await expect(dana.page.getByRole("menu")).toBeVisible();
        await expect(writeOff).toHaveCount(0);
        await dana.page.keyboard.press("Escape");

        // 7. Two saves audited as Grace: step 3 and the restore; the refused step 2 wrote none.
        expect(await auditBy(grace.request, "Changed payments", "Grace Liu", since)).toBe(audited + 2);
      },
    );
  });

  flowTest.describe("company profile and expense approval", () => {
    resetAuthAround([OWNER_EMAIL, SALES_EMAIL]);

    flowTest(
      "E3 Company profile and expense approval round-trip through the API, and only their readers get them",
      async ({ personas }) => {
        flowTest.setTimeout(120_000);
        const dana = await personas.open(OWNER_EMAIL, { mfa: true });
        const priya = await personas.open(SALES_EMAIL);
        const start = await readAs<SettingsAnswer>(dana.request, "/settings");
        const seededProfile = { ...start.profile!, email: SUMMIT_EMAIL };
        if (start.profile?.email !== SUMMIT_EMAIL) {
          expect(start.profile?.email, "the profile email is Summit's seeded one or an earlier run's").toMatch(/^e2e-/);
          expect((await healSection(dana.request, "profile", seededProfile)).status()).toBe(200);
        }
        personas.onCleanup("put the profile email back", () => healOrThrow(dana.request, "profile", seededProfile));
        personas.onCleanup("put expense approval back", () => healOrThrow(dana.request, "expenses", SUMMIT_EXPENSES));
        expect((await healSection(dana.request, "expenses", SUMMIT_EXPENSES)).status()).toBe(200);
        const email = `e2e-${runId()}@summitfloor.example`;

        // 1. Dana saves a new email on Company profile.
        await dana.page.goto("/settings/company");
        await dana.page.getByLabel("Email", { exact: true }).fill(email);
        const profilePut = dana.page.waitForResponse(
          (response) =>
            response.request().method() === "PUT" && new URL(response.url()).pathname === "/api-proxy/settings/profile",
        );
        await dana.page.getByRole("button", { name: "Save company profile" }).click();
        expect((await profilePut).status()).toBe(200);
        await expect(dana.page.getByText("Company profile saved")).toBeVisible();

        // 2. Priya's invoice prints it; she reads no EIN and no expense approval.
        const [mine] = await readAs<Invoice[]>(priya.request, "/invoices");
        expect(mine, "Priya has an invoice").toBeDefined();
        await priya.page.goto(`/sales/invoices/${mine.id}`);
        await expect(priya.page.getByRole("article").first()).toContainText(email);
        const hers = await readAs<SettingsAnswer>(priya.request, "/settings");
        expect(hers.profile?.ein).toBe("");
        expect(hers).not.toHaveProperty("expenses");
        expect((await readAs<SettingsAnswer>(dana.request, "/settings")).profile?.ein).toBe(start.profile?.ein);
        expect(start.profile?.ein).toMatch(/^\d{2}-\d{7}$/);

        // 3. Expense approval saves alone; Shared costs stays in the browser.
        const sharedCosts: string[] = [];
        dana.page.on("request", (request) => {
          if (new URL(request.url()).pathname === "/api-proxy/settings/sharedCosts") sharedCosts.push(request.url());
        });
        await dana.page.goto("/settings/expenses");
        await dana.page.getByLabel("Approval above").fill("750.00");
        const expensesPut = dana.page.waitForResponse(
          (response) =>
            response.request().method() === "PUT" &&
            new URL(response.url()).pathname === "/api-proxy/settings/expenses",
        );
        await dana.page.getByRole("button", { name: "Save expense approval" }).click();
        expect((await expensesPut).status()).toBe(200);
        await expect(dana.page.getByText("Expense approval saved")).toBeVisible();
        expect(sharedCosts).toEqual([]);
        await dana.page.reload();
        await expect(dana.page.getByLabel("Approval above")).toHaveValue("750.00");
        expect((await readAs<SettingsAnswer>(dana.request, "/settings")).expenses?.approvalThreshold).toBe("750.00");

        // 4. Put both back.
        expect((await healOrThrow(dana.request, "profile", seededProfile)).status()).toBe(200);
        expect((await healOrThrow(dana.request, "expenses", SUMMIT_EXPENSES)).status()).toBe(200);
      },
    );
  });
});
