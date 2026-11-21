import { randomBytes } from "node:crypto";
import { expect, test, type APIResponse, type Page } from "@playwright/test";
import {
  inviteTestOwner,
  provisionTestCompany,
  resetAuthState,
  retireTestCompany,
  sweepTestCompanies,
  type FreshTestServer,
} from "@workspace/db/testing";
import {
  planActions,
  type AuditEntry,
  type Customer,
  type ImportBatchSummary,
  type ImportPreview,
  type ImportRequest,
  type ImportResult,
  type Invoice,
} from "@workspace/shared";
import { nextCode, totpCode } from "../accounts";
import { auditTime } from "../flows/checks";
import { assertThrowawayDb, checkOnly } from "./opt-in";

/** Leftovers of killed runs older than this are retired before a run starts (ADR 0058, S-8). */
const SWEEP_AFTER_MS = 2 * 3_600_000;

/** What provisioning names every fresh test company and its Owner (`provisionTestCompany`). */
const COMPANY_NAME = "Fresh Test Floors";
const OWNER_NAME = "Avery Fresh";

/** The words the login page shows a signed-in person whose company the web workspace can't open (gap G1). */
const NO_WORKSPACE = "Your account is ready, but not this workspace.";

/** The JSON of an API answer through the web proxy, after checking its status. */
async function answer<T>(response: APIResponse, status: number): Promise<T> {
  expect(response.status(), `${response.url()} answered`).toBe(status);
  return (await response.json()) as T;
}

/** Signs in on the real login page and sets up the authenticator app the Owner role needs; returns its key. */
async function signInAndEnrol(page: Page, email: string, password: string): Promise<string> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Confirm your password").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
  const secret = (await page.getByTestId("mfa-setup-key").getAttribute("data-key")) ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+=*$/);
  await page.getByLabel("Code from the app").fill(totpCode(secret));
  await page.getByRole("button", { name: "Turn on two-step sign-in" }).click();
  await page.getByLabel("I have saved my backup codes").check();
  await page.getByRole("button", { name: "Continue" }).click();
  return secret;
}

// No traces: the run types a password and opens an invitation link (ADR 0058, S-7). Playwright
// allows `trace` only at the top of a file.
test.use({ trace: "off" });

// A brand-new company end to end in the browser (whole-product check FC; plan section 5.3; ADR
// 0058): provisioned the real way on the throwaway e2e database, its Owner invited in place of the
// invitation provisioning doesn't send yet (gap G4), accepting it on the real page, signing in with
// MFA, and then meeting gap G1: the web workspace opens only the demo companies. Its writes and a
// step-up go through the web proxy. Opt-in (`WHOLE_CHECK=1`); the company is retired afterwards
// unless KEEP_FRESH=1.
test.describe("a fresh company end to end, with its gaps (whole-product check FC)", { tag: "@check" }, () => {
  checkOnly();
  test.describe.configure({ timeout: 180_000 });

  const run = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const slug = `e2efresh${run}`;
  const ownerEmail = `owner.${run}@fresh.e2e.example`;
  const password = randomBytes(18).toString("base64url");
  const supplierName = `Front Range Supply ${run}`;
  const state: { server: FreshTestServer | null; tenantId: string; token: string; startedAt: number } = {
    server: null,
    tenantId: "",
    token: "",
    startedAt: Date.now(),
  };

  test.beforeAll(async () => {
    const server = assertThrowawayDb();
    state.server = server;
    const swept = await sweepTestCompanies(server, SWEEP_AFTER_MS);
    if (swept.length > 0) console.info(`fresh-company: retired leftovers of killed runs: ${swept.join(", ")}.`);
    const created = await provisionTestCompany(server, { slug, ownerEmail, products: ["flooring"] });
    state.tenantId = created.tenantId;
    state.token = await inviteTestOwner(server.controlUrl, slug);
  });

  test.afterAll(async () => {
    const { server } = state;
    if (!server) return;
    if (process.env.KEEP_FRESH === "1") console.info(`fresh-company: KEEP_FRESH=1, ${slug} is kept.`);
    else await retireTestCompany(server, slug);
    await resetAuthState(server.controlUrl, [ownerEmail]);
  });

  test("FC-1 to FC-5, GAP-G1 and GAP-G2: the Owner accepts the real invitation, signs in with MFA, meets the web gap, and works through the proxy", async ({
    page,
  }) => {
    test.info().annotations.push({
      type: "GAP-G1",
      description:
        "toCompanySession (apps/web/src/lib/session/api-context.ts) opens only the demo slugs; STATUS: “G1, the web workspace for new companies”",
    });
    let secret = "";

    await test.step("FC-1, GAP-G1: accept the invitation, sign in with MFA, and find no workspace", async () => {
      await page.goto(`/accept-invite?token=${state.token}`);
      await expect(page.getByText(`Join ${COMPANY_NAME}`)).toBeVisible();
      await expect(page.getByText(`Choose a password for ${ownerEmail}.`)).toBeVisible();
      await page.getByLabel("New password").fill(password);
      await page.getByLabel("Type it again").fill(password);
      const accepted = page.waitForResponse(
        (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api-proxy/public/invitations/accept",
      );
      await page.getByRole("button", { name: "Accept and set password" }).click();
      expect((await accepted).status()).toBe(204);
      await expect(page.getByText(`You are in. Sign in with ${ownerEmail}.`)).toBeVisible();
      secret = await signInAndEnrol(page, ownerEmail, password);
      await expect(page.getByText(NO_WORKSPACE)).toBeVisible();
      await page.goto("/");
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByText(NO_WORKSPACE)).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
    });

    await test.step("FC-2: the session names the new company with MFA done, and its standing is full", async () => {
      const company = { id: state.tenantId, slug, name: COMPANY_NAME };
      expect(await answer(await page.request.get("/api-proxy/auth/context"), 200)).toMatchObject({
        user: { email: ownerEmail, name: OWNER_NAME },
        company,
        companies: [company],
        mfa: { state: "ok" },
      });
      expect(await answer(await page.request.get("/api-proxy/company/standing"), 200)).toEqual({ state: "full" });
    });

    await test.step("FC-3, GAP-G2: a supplier is saved and audited; a customer added by hand waits for Localization", async () => {
      const supplier = { name: supplierName, type: "goods", terms: "net_30", email: `orders.${run}@fresh.e2e.example` };
      expect(await answer(await page.request.post("/api-proxy/suppliers", { data: supplier }), 201)).toMatchObject({
        name: supplierName,
      });
      // Finding F-n (as FA-4 pins on the API): adding a customer reads the default terms from Localization.
      const customer = { name: `Avery Brook ${run}` };
      expect(await answer(await page.request.post("/api-proxy/customers", { data: customer }), 409)).toMatchObject({
        code: "settings_missing",
        message: "Finish Settings → Localization and tax before adding customers.",
      });
      const audit = await answer<AuditEntry[]>(await page.request.get("/api-proxy/audit"), 200);
      expect(audit.map((entry) => [entry.action, entry.target, entry.actorName, entry.actorRole])).toEqual([
        ["Added supplier", supplierName, OWNER_NAME, "Owner"],
      ]);
      // `at` is an ISO instant with its zone mark (ADR 0064), read as one and
      // compared with the run's start cut to its minute.
      expect(auditTime(audit[0].at)).toBeGreaterThanOrEqual(Math.floor(state.startedAt / 60_000) * 60_000);
    });

    await test.step("FC-4: a customers file is checked, imported after a step-up through the proxy, and undone", async () => {
      const customerName = `Riley Hart ${run}`;
      const file: ImportRequest = {
        kind: "customers",
        fileName: `fresh-${run}.csv`,
        table: { headers: ["Name", "Email"], rows: [[customerName, `riley.${run}@fresh.e2e.example`]] },
        mapping: { name: "Name", email: "Email" },
      };
      const preview = await answer<ImportPreview>(
        await page.request.post("/api-proxy/imports/check", { data: file }),
        200,
      );
      expect(preview.counts).toEqual({ create: 1, update: 0, skip: 0, error: 0 });
      const stepUp = await page.request.post("/api-proxy/auth/step-up", { data: { code: nextCode(secret) } });
      expect(stepUp.status()).toBe(204);
      const imported = await answer<ImportResult>(
        await page.request.post("/api-proxy/imports", { data: { ...file, expected: planActions(preview.rows) } }),
        201,
      );
      expect(imported.batch.counts).toEqual({ create: 1, update: 0, skip: 0, error: 0 });
      const customers = await answer<Customer[]>(await page.request.get("/api-proxy/customers"), 200);
      expect(customers.map((row) => [row.name, row.terms])).toEqual([[customerName, "due_on_receipt"]]);
      const undone = await answer<ImportBatchSummary>(
        await page.request.post(`/api-proxy/imports/${imported.batch.id}/undo`),
        201,
      );
      expect(undone).toMatchObject({ id: imported.batch.id, undoneBy: OWNER_NAME });
      expect(await answer<Customer[]>(await page.request.get("/api-proxy/customers"), 200)).toEqual([]);
    });

    await test.step("FC-5: the new company has no invoices", async () => {
      expect(await answer<Invoice[]>(await page.request.get("/api-proxy/invoices"), 200)).toEqual([]);
    });
  });
});
