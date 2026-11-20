import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import type { SettingsAnswer } from "@workspace/shared";
import { OWNER_EMAIL, SALES_EMAIL } from "./accounts";
import { auditEntriesBy, canonical, readAs } from "./flows/checks";
import { flowTest, resetAuthAround } from "./flows/kit";

/**
 * Summit's seeded shared costs (packages/shared/fixtures/summit.json), as `PUT /settings/sharedCosts`
 * takes them back. Written out, not imported, so this spec builds on code without the shared rule.
 */
const SUMMIT_SHARED_COSTS = { rule: "revenue", fixedPct: {} };
const DANA = "Dana Whitfield";
const ACTION = "Changed shared costs";
const TOTAL_90 = "The percentages add up to 90. They must add up to 100.";
const UNKNOWN_LOCATION = "A share names a location this company doesn't have. Reload the page and try again.";

/** A location as `GET /locations` answers it, narrowed to what this spec reads. */
interface ApiLocation {
  id: string;
  name: string;
}

/**
 * Puts shared costs back unless `GET /settings` already answers them, failing unless the API takes
 * it. Returns the last answer, the read when nothing needed changing.
 */
async function healOrThrow(request: APIRequestContext): Promise<APIResponse> {
  const read = await request.get("/api-proxy/settings");
  expect(read.status(), `GET /settings answered ${read.status()}: ${await read.text()}`).toBe(200);
  const answer = (await read.json()) as SettingsAnswer;
  if (canonical(answer.sharedCosts) === canonical(SUMMIT_SHARED_COSTS)) return read;
  const response = await request.put("/api-proxy/settings/sharedCosts", { data: SUMMIT_SHARED_COSTS });
  if (response.status() !== 200)
    throw new Error(`Putting shared costs back answered ${response.status()}: ${await response.text()}`);
  return response;
}

/** Every PUT the page sends to `/settings/sharedCosts`, recorded from now on. */
function sharedCostPuts(page: Page): string[] {
  const puts: string[] = [];
  page.on("request", (request) => {
    if (request.method() === "PUT" && new URL(request.url()).pathname === "/api-proxy/settings/sharedCosts")
      puts.push(request.url());
  });
  return puts;
}

/**
 * Settings part 4b on the API (ADR 0059, part 4b; ADR 0023): Settings → Expenses saves Shared costs
 * through `PUT /settings/sharedCosts`, refuses a split that doesn't add up to 100 with the API's
 * words before anything is sent, and only the key's holders read it; the API refuses what the page
 * doesn't offer. Each test heals Summit's revenue-share rule first and registers a clean-up that puts
 * it back, failing if the API refuses.
 */
flowTest.describe("Settings part 4b on the API (api mode)", () => {
  flowTest.describe("the page", () => {
    resetAuthAround([OWNER_EMAIL, SALES_EMAIL]);

    flowTest(
      "SCE1 Shared costs round-trip through the API: a split that isn't 100 is refused on the page and sends nothing, a fixed split saves, reloads and is audited once, and Priya doesn't read it",
      async ({ personas }) => {
        flowTest.setTimeout(120_000);
        const dana = await personas.open(OWNER_EMAIL, { mfa: true });
        const priya = await personas.open(SALES_EMAIL);
        personas.onCleanup("put shared costs back", () => healOrThrow(dana.request));
        await healOrThrow(dana.request);
        const locations = await readAs<ApiLocation[]>(dana.request, "/locations");
        const denver = locations.find((location) => location.name === "Denver Central");
        const springs = locations.find((location) => location.name === "Colorado Springs");
        if (!denver || !springs) throw new Error("the e2e database has no Denver Central or Colorado Springs");
        const since = Date.now();
        const seen = new Set((await auditEntriesBy(dana.request, ACTION, DANA, since)).map((entry) => entry.id));
        const page = dana.page;
        const puts = sharedCostPuts(page);

        // 1. Fixed percentages that add up to 90: the page says why, and Save sends nothing.
        await page.goto("/settings/expenses");
        await page.getByLabel("How company-wide costs are shared").click();
        await page.getByRole("option", { name: "Fixed percentages" }).click();
        await page.getByLabel("Denver Central percent").fill("60");
        await page.getByLabel("Colorado Springs percent").fill("30");
        await expect(page.getByRole("alert").filter({ hasText: TOTAL_90 })).toBeVisible();
        await page.getByRole("button", { name: "Save shared costs" }).click();
        await expect(page.getByText(TOTAL_90).last()).toBeVisible();
        expect(puts).toEqual([]);

        // 2. 70 and 30 save through the API.
        await page.getByLabel("Denver Central percent").fill("70");
        const saved = page.waitForResponse(
          (response) =>
            response.request().method() === "PUT" &&
            new URL(response.url()).pathname === "/api-proxy/settings/sharedCosts",
        );
        await page.getByRole("button", { name: "Save shared costs" }).click();
        expect((await saved).status()).toBe(200);
        await expect(page.getByText("Shared costs saved")).toBeVisible();
        const stored = { rule: "fixed", fixedPct: { [denver.id]: "70", [springs.id]: "30" } };
        expect(canonical((await readAs<SettingsAnswer>(dana.request, "/settings")).sharedCosts)).toBe(
          canonical(stored),
        );

        // 3. After a reload the page shows what the API holds.
        await page.reload();
        await expect(page.getByLabel("Denver Central percent")).toHaveValue("70");
        await expect(page.getByLabel("Colorado Springs percent")).toHaveValue("30");

        // 4. One audit entry for the save; Priya, without the key, isn't answered shared costs.
        const audited = (await auditEntriesBy(dana.request, ACTION, DANA, since)).filter(
          (entry) => !seen.has(entry.id),
        );
        expect(audited).toHaveLength(1);
        expect(await readAs<SettingsAnswer>(priya.request, "/settings")).not.toHaveProperty("sharedCosts");

        // 5. What the page never sends, the API refuses with the same words: a share for no location.
        const refused = await dana.request.put("/api-proxy/settings/sharedCosts", {
          data: { rule: "fixed", fixedPct: { [denver.id]: "100", "no-such-location": "0" } },
        });
        expect(refused.status()).toBe(400);
        expect(((await refused.json()) as { message: string }).message).toBe(UNKNOWN_LOCATION);
        const forbidden = await priya.request.put("/api-proxy/settings/sharedCosts", { data: SUMMIT_SHARED_COSTS });
        expect(forbidden.status()).toBe(403);

        // 6. Put Summit's rule back.
        await healOrThrow(dana.request);
      },
    );
  });
});
