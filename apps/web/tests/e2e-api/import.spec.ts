import { expect, test, type Page } from "@playwright/test";
import { resetAuthState } from "@workspace/db/testing";
import type { ImportOverview, ImportResult } from "@workspace/shared";
import { OWNER_EMAIL, signInAndEnrolOwner, totpCode } from "./accounts";

/** The control database the API uses (global-setup.ts checks it is set). */
const CONTROL_URL = process.env.CONTROL_DATABASE_URL ?? "";

/** An authenticator code covers one 30-second step (RFC 6238). */
const STEP_MS = 30_000;

/** The 30-second step a moment falls in. */
function stepOf(at: number): number {
  return Math.floor(at / STEP_MS);
}

/**
 * An authenticator code from a later 30-second step than `after`, waiting for the clock when the
 * next step is not later yet. Like `nextCode` it is the code for the coming step (within the
 * allowed drift), so no code of this run is ever sent twice.
 */
async function codeAfter(page: Page, secret: string, after: number): Promise<{ code: string; step: number }> {
  while (stepOf(Date.now() + STEP_MS) <= after) await page.waitForTimeout(1_000);
  const at = Date.now() + STEP_MS;
  return { code: totpCode(secret, new Date(at)), step: stepOf(at) };
}

/** Answers the step-up dialog with a code. */
async function confirmStepUp(page: Page, code: string): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "Confirm it is you" });
  await dialog.getByLabel("Authenticator code").fill(code);
  await dialog.getByRole("button", { name: "Confirm" }).click();
}

/** Waits for the answer to one import route, by method and path. */
function importResponse(page: Page, method: string, path: RegExp) {
  return page.waitForResponse((r) => r.request().method() === method && path.test(new URL(r.url()).pathname));
}

/** Picks Customers in the wizard and uploads the run's file, landing on the columns step. */
async function uploadCustomers(page: Page, csv: string): Promise<void> {
  await page.getByRole("radio", { name: "Customers", exact: true }).check();
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "File: customers" })).toBeVisible();
  await page
    .getByLabel(/Choose a CSV or Excel file/)
    .setInputFiles({ name: "customers.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await expect(page.getByText(/customers\.csv: 3 rows and 6 columns/)).toBeVisible();
  await page.getByRole("button", { name: "Next" }).click();
}

/** Clicks "Check the file" and returns the dry run's HTTP status. */
async function checkFile(page: Page): Promise<number> {
  const answer = importResponse(page, "POST", /^\/api-proxy\/imports\/check$/);
  await page.getByRole("button", { name: "Check the file" }).click();
  return (await answer).status();
}

/** Opens the customer list and searches it for the run's customers. */
async function searchCustomers(page: Page, run: string): Promise<void> {
  await page.goto("/sales?view=customers");
  await page.getByLabel("Search customers").fill(`e2e-imp-${run}`);
}

// Data import on the real API, part 1 (docs/product-spec/import.md; ADR 0057): the Owner imports
// customers from a CSV through the dry run, a step-up and the commit, re-imports the same file as
// all skips, then undoes the batch. Every name, External ID and email is unique to the run, so the
// spec can run again on the same database. What stays afterwards is the run's soft-deleted
// customers and addresses, its undone batch and its audit rows (the log is append-only). If a step
// fails before the Undo, afterEach undoes the batch through the API (it runs after a timeout too).
test.describe("data import (api mode)", () => {
  const run = Date.now().toString(36);
  const csv = [
    "External ID,Name,Email,Phone,Payment terms,Credit limit",
    `E2E-IMP-${run}-1,e2e-imp-${run}-1,e2e-imp-${run}-1@import.example,(303) 555-0142,Net 30,25000`,
    `E2E-IMP-${run}-2,e2e-imp-${run}-2,e2e-imp-${run}-2@import.example,(719) 555-0107,Net 30,15000.00`,
    `E2E-IMP-${run}-3,e2e-imp-${run}-3,not-an-email,(720) 555-0188,Net 30,0`,
  ].join("\n");
  // The Owner's authenticator key, the last 30-second step a code was used for, and the run's batch.
  const state: { secret: string; lastStep: number; batch: { id: string; number: string } | null; undone: boolean } = {
    secret: "",
    lastStep: 0,
    batch: null,
    undone: false,
  };

  test.beforeAll(async () => {
    await resetAuthState(CONTROL_URL, [OWNER_EMAIL]);
  });

  test.afterEach(async ({ page }) => {
    const { batch, secret } = state;
    if (!batch || state.undone) return;
    // The run's batch is still live: step up with a fresh code and undo it, so nothing is left in use.
    const { code } = await codeAfter(page, secret, state.lastStep);
    await page.request.post("/api-proxy/auth/step-up", { data: { code } });
    const undo = await page.request.post(`/api-proxy/imports/${batch.id}/undo`);
    // A 409 `already_undone` means the screen's Undo went through before the step failed.
    if (undo.status() !== 201)
      expect(await undo.json(), `cleanup Undo of ${batch.number}`).toMatchObject({ code: "already_undone" });
    state.undone = true;
  });

  test.afterAll(async () => {
    await resetAuthState(CONTROL_URL, [OWNER_EMAIL]);
  });

  test("the Owner imports customers after a dry run and a step-up, re-imports them as skips and undoes the batch", async ({
    page,
  }) => {
    test.setTimeout(180_000);
    state.secret = await signInAndEnrolOwner(page);
    state.lastStep = stepOf(Date.now());

    await test.step("EA-1 Settings → Data import offers the four part-1 kinds", async () => {
      const overview = importResponse(page, "GET", /^\/api-proxy\/imports$/);
      await page.goto("/settings/import");
      const answer = await overview;
      expect(answer.status()).toBe(200);
      expect(answer.headers()["cache-control"] ?? "").toContain("no-store");
      expect(((await answer.json()) as ImportOverview).kinds).toEqual([
        "customers",
        "addresses",
        "suppliers",
        "products",
      ]);
      const kinds = page.getByRole("radiogroup", { name: "What to import" }).getByRole("radio");
      await expect(kinds).toHaveCount(4);
      for (const [i, name] of ["Customers", "Customer addresses", "Suppliers", "Products"].entries())
        await expect(kinds.nth(i)).toHaveAccessibleName(name);
    });

    await test.step("EA-2 the dry run creates two and leaves the bad row out", async () => {
      await uploadCustomers(page, csv);
      await expect(page.getByRole("combobox", { name: "Credit limit" })).toHaveText("Credit limit");
      expect(await checkFile(page)).toBe(200);
      await expect(page.getByText("Creates 2, updates 0, skips 0; 1 row has errors and is left out.")).toBeVisible();
      await expect(page.getByText("Email: “not-an-email” is not an email address.")).toBeVisible();
    });

    await test.step("EA-3 Import 2 rows asks for a step-up, then commits the batch", async () => {
      const committed = importResponse(page, "POST", /^\/api-proxy\/imports$/);
      await page.getByRole("button", { name: "Import 2 rows" }).click();
      await expect(page.getByRole("dialog", { name: "Confirm it is you" })).toContainText("Importing 2 rows");
      const { code, step } = await codeAfter(page, state.secret, state.lastStep);
      state.lastStep = step;
      await confirmStepUp(page, code);
      const answer = await committed;
      expect(answer.status()).toBe(201);
      const { batch } = (await answer.json()) as ImportResult;
      state.batch = { id: batch.id, number: batch.number };
      expect(batch.number).toMatch(/^IMP-\d{4,}$/);
      expect(batch.counts).toEqual({ create: 2, update: 0, skip: 0, error: 1 });
      await expect(page.getByText(`${batch.number} imported from customers.csv`, { exact: true })).toBeVisible();
    });

    await test.step("EA-4 the imported customers list under Sales → Customers", async () => {
      await searchCustomers(page, run);
      await expect(page.getByText(`e2e-imp-${run}-1`, { exact: true })).toBeVisible();
      await expect(page.getByText(`e2e-imp-${run}-2`, { exact: true })).toBeVisible();
      await expect(page.getByText(`e2e-imp-${run}-3`, { exact: true })).toHaveCount(0);
    });

    await test.step("EA-5 the same file again is all skips, so there is nothing to import", async () => {
      await page.goto("/settings/import");
      await uploadCustomers(page, csv);
      expect(await checkFile(page)).toBe(200);
      await expect(page.getByText("Creates 0, updates 0, skips 2; 1 row has errors and is left out.")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Import \d+ rows?$/ })).toBeDisabled();
    });

    await test.step("EA-6 Undo from the history, after a step-up with a later code", async () => {
      const { number } = state.batch!;
      const history = page.getByRole("region", { name: "Import history" });
      await expect(
        history.getByRole("row", { name: new RegExp(`${number}.*Customers.*customers\\.csv`) }),
      ).toBeVisible();
      await history.getByRole("button", { name: `Undo ${number}` }).click();
      await page
        .getByRole("dialog", { name: `Undo ${number}?` })
        .getByRole("button", { name: "Undo import" })
        .click();
      await expect(page.getByRole("dialog", { name: "Confirm it is you" })).toContainText(`Undoing ${number}`);
      const undone = importResponse(page, "POST", /^\/api-proxy\/imports\/[^/]+\/undo$/);
      const { code, step } = await codeAfter(page, state.secret, state.lastStep);
      state.lastStep = step;
      await confirmStepUp(page, code);
      expect((await undone).status()).toBe(201);
      state.undone = true;
      await expect(page.getByText(`${number} undone`)).toBeVisible();
      await expect(history.getByRole("button", { name: `Undo ${number}` })).toHaveCount(0);

      await searchCustomers(page, run);
      await expect(page.getByText("Nothing matches these filters.")).toBeVisible();
      await expect(page.getByText(`e2e-imp-${run}-1`, { exact: true })).toHaveCount(0);
      await expect(page.getByText(`e2e-imp-${run}-2`, { exact: true })).toHaveCount(0);
    });
  });
});
