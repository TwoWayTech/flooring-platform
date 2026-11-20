import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { STOCK_RULES_MESSAGES, type InventorySettings, type SettingsAnswer } from "@workspace/shared";
import { OWNER_EMAIL, SALES_EMAIL } from "./accounts";
import { auditBy, canonical, confirmStepUp, expectAuditRows, putWithStepUp, readAs } from "./flows/checks";
import { flowTest, resetAuthAround } from "./flows/kit";

const ACTION = "Changed stock rules";
const DANA = "Dana Whitfield";
const FIELD = "Adjustments that need approval";

/**
 * Puts Stock rules back to `value` unless `GET /settings` already answers it, with a step-up when the
 * API asks for one (raising the quantity back is a loosening). Throws unless the API answered 200.
 */
async function healStockOrThrow(request: APIRequestContext, value: InventorySettings, secret: string) {
  const read = await request.get("/api-proxy/settings");
  expect(read.status(), `GET /settings answered ${read.status()}: ${await read.text()}`).toBe(200);
  if (canonical(((await read.json()) as SettingsAnswer).inventory) === canonical(value)) return read;
  const response: APIResponse = await putWithStepUp(request, secret, "/settings/inventory", value);
  if (response.status() !== 200)
    throw new Error(`Putting Stock rules back answered ${response.status()}: ${await response.text()}`);
  return response;
}

/**
 * Stock rules on the API (ADR 0059, the Stock rules part): the form on Warehouses and showrooms reads
 * and saves through `GET /settings` and `PUT /settings/inventory`; a malformed quantity is refused
 * with the shared words before any code; lowering saves without a code and clearing asks for one;
 * Sales neither reads nor saves the section. The test takes Summit's section as it finds it and puts
 * it back as its last step, with a clean-up that repeats the restore.
 */
flowTest.describe("Stock rules on the API (api mode)", () => {
  resetAuthAround([OWNER_EMAIL, SALES_EMAIL]);

  flowTest(
    "ST1 the Owner lowers the approval quantity without a code, clears it with one; a malformed one says why; Sales can't",
    async ({ personas }) => {
      flowTest.setTimeout(150_000);
      const dana = await personas.open(OWNER_EMAIL, { mfa: true });
      const priya = await personas.open(SALES_EMAIL);
      const secret = dana.secret!;
      const original = (await readAs<SettingsAnswer>(dana.request, "/settings")).inventory;
      expect(original, "Summit's seeded Stock rules").toBeDefined();
      personas.onCleanup("put Stock rules back", () => healStockOrThrow(dana.request, original!, secret));
      // Start from a known quantity, so lowering and clearing mean the same on every run.
      await healStockOrThrow(dana.request, { adjustmentApprovalQty: "1000" }, secret);
      const since = Date.now();
      const audited = await auditBy(dana.request, ACTION, DANA, since);
      const putDone = () =>
        dana.page.waitForResponse(
          (response) =>
            response.request().method() === "PUT" &&
            new URL(response.url()).pathname === "/api-proxy/settings/inventory",
        );

      // 1. A malformed quantity is refused with the shared words, and no code is asked for.
      await dana.page.goto("/settings/locations");
      const field = dana.page.getByLabel(FIELD);
      await expect(field).toHaveValue("1000");
      await field.fill("12.");
      await dana.page.getByRole("button", { name: "Save stock rules" }).click();
      await expect(dana.page.getByText(STOCK_RULES_MESSAGES.adjustmentApprovalQty)).toBeVisible();
      await expect(dana.page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0);

      // 2. Lowering tightens the check: saved at once, no code.
      await field.fill("250");
      const lowered = putDone();
      await dana.page.getByRole("button", { name: "Save stock rules" }).click();
      expect((await lowered).status()).toBe(200);
      await expect(dana.page.getByText("Stock rules saved")).toBeVisible();
      await expect(dana.page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0);

      // 3. Clearing it lets every adjustment through alone: the Owner's, with a code.
      await field.fill("");
      const cleared = putDone();
      await dana.page.getByRole("button", { name: "Save stock rules" }).click();
      await confirmStepUp(dana.page, secret);
      expect((await cleared).status()).toBe(200);

      // 4. After a reload the form reads it from the API.
      await dana.page.reload();
      await expect(dana.page.getByLabel(FIELD)).toHaveValue("");
      expect((await readAs<SettingsAnswer>(dana.request, "/settings")).inventory).toEqual({
        adjustmentApprovalQty: "",
      });

      // 5. Sales reads no Stock rules and can't save them.
      expect(await readAs<SettingsAnswer>(priya.request, "/settings")).not.toHaveProperty("inventory");
      const denied = await priya.request.put("/api-proxy/settings/inventory", { data: original });
      expect(denied.status()).toBe(403);
      expect((await denied.json()).code).toBe("forbidden");

      // 6. Put back; the three saves (lowered, cleared, put back) are audited as Dana, on screen too.
      await healStockOrThrow(dana.request, original!, secret);
      expect(await auditBy(dana.request, ACTION, DANA, since)).toBe(audited + 3);
      await expectAuditRows(dana.page, "Stock rules", [ACTION], since);
    },
  );
});
