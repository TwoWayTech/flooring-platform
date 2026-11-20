import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { OWNER_EMAIL, SALES_EMAIL } from "./accounts";
import { auditEntriesBy, canonical, readAs } from "./flows/checks";
import { flowTest, resetAuthAround } from "./flows/kit";

/**
 * A location as `GET /locations` answers it. Written out, not imported, so this spec builds on code
 * without the shared location rules.
 */
interface ApiLocation {
  id: string;
  name: string;
  kind: "warehouse" | "showroom";
  branchId: string;
  address: { street: string; city: string; state: string; zip: string; county?: string };
  isDefault: boolean;
  displaySamples: number;
  floorAreaSqFt?: string;
}

const SOUTHGATE_STREET = "3380 Meadowgate Drive";
const DANA = "Dana Whitfield";
const HOLDS_STOCK = "Colorado Springs holds stock. Transfer it out before making it a showroom.";
const BRANCH_FIXED =
  "A location stays in the branch it was added to: its expenses and quotes are seen by that branch. Add a new location instead.";

/** Summit's seeded Southgate Showroom (packages/shared/fixtures/summit.json), as a PUT takes it back. */
function southgate(branchId: string) {
  return {
    name: "Southgate Showroom",
    kind: "showroom",
    branchId,
    address: { street: SOUTHGATE_STREET, city: "Colorado Springs", state: "CO", zip: "80920", county: "El Paso" },
    isDefault: false,
    displaySamples: 96,
    floorAreaSqFt: "2400",
  };
}

/** Colorado Springs as read, as the warehouse it is seeded as, without its id. */
function colorado(springs: ApiLocation) {
  const body: Partial<ApiLocation> = { ...springs, kind: "warehouse", isDefault: false, displaySamples: 0 };
  delete body.id;
  return body;
}

/** Summit's locations through the API. */
function locationsOf(request: APIRequestContext): Promise<ApiLocation[]> {
  return readAs<ApiLocation[]>(request, "/locations");
}

/** Southgate Showroom, found by its street, since a killed run may have renamed it. */
async function southgateOf(request: APIRequestContext): Promise<ApiLocation> {
  const found = (await locationsOf(request)).find((location) => location.address.street === SOUTHGATE_STREET);
  if (!found) throw new Error("the e2e database has no Southgate Showroom");
  return found;
}

/** Colorado Springs, by name. */
async function springsOf(request: APIRequestContext): Promise<ApiLocation> {
  const found = (await locationsOf(request)).find((location) => location.name === "Colorado Springs");
  if (!found) throw new Error("the e2e database has no Colorado Springs");
  return found;
}

/** Puts a location back through `PUT /locations/:id`, failing unless the API takes it. */
async function restoreOrThrow(request: APIRequestContext, id: string, body: object) {
  const response = await request.put(`/api-proxy/locations/${id}`, { data: body });
  if (response.status() !== 200) throw new Error(`PUT /locations/${id} answered ${response.status()}: ${await response.text()}`);
  return response;
}

/** The Branch cell of a row, matched exactly: the City cell reads "<city>, CO". */
function branchCell(page: Page, row: RegExp, branch: string) {
  return page.getByRole("row", { name: row }).first().getByRole("cell", { name: branch, exact: true });
}

/** The ids of Dana's location audit entries since `since`. */
async function locationAudits(request: APIRequestContext, since: number) {
  return [
    ...(await auditEntriesBy(request, "Added location", DANA, since)),
    ...(await auditEntriesBy(request, "Changed location", DANA, since)),
  ];
}

/**
 * Settings part 4a on the API (ADR 0059, part 4a; spec settings-and-permissions.md rule 29): the
 * page lists and saves Summit's locations through `GET /locations` and `PUT /locations/:id`, names
 * branches from the shell, keeps a warehouse with stock one, and sends a new location to POST
 * without an id; what the page doesn't offer, the API refuses. Each test heals Southgate Showroom
 * first and registers clean-ups that put it and Colorado Springs back, failing if the API refuses.
 */
flowTest.describe("Settings part 4a on the API (api mode)", () => {
  resetAuthAround([OWNER_EMAIL, SALES_EMAIL]);

  flowTest(
    "LNE1 Warehouses and showrooms on the API: a showroom's change round-trips and shows in another person's picker, a warehouse with stock stays one, and a new location goes to POST without an id",
    async ({ personas }) => {
      flowTest.setTimeout(150_000);
      const dana = await personas.open(OWNER_EMAIL, { mfa: true });
      const priya = await personas.open(SALES_EMAIL);
      const sg = await southgateOf(dana.request);
      const cs = await springsOf(dana.request);
      personas.onCleanup("put Southgate back", () => restoreOrThrow(dana.request, sg.id, southgate(sg.branchId)));
      personas.onCleanup("put Colorado Springs back", () => restoreOrThrow(dana.request, cs.id, colorado(cs)));
      await restoreOrThrow(dana.request, sg.id, southgate(sg.branchId));
      const healed = await southgateOf(dana.request);
      const since = Date.now();
      const seen = new Set((await locationAudits(dana.request, since)).map((entry) => entry.id));
      const page = dana.page;

      // 1. The API's locations, their branches named from the shell's.
      await page.goto("/settings/locations");
      await expect(branchCell(page, /Southgate Showroom/, "Colorado Springs")).toBeVisible();
      await expect(branchCell(page, /Denver Central/, "Denver")).toBeVisible();
      await expect(page.getByRole("row", { name: /Denver Central/ }).first()).toContainText("Default");

      // 2. Edit Southgate: the branch is read only; the floor area reads at scale.
      await page.getByRole("row", { name: /Southgate Showroom/ }).first().click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("combobox", { name: "Branch" })).toBeDisabled();
      await expect(dialog.getByLabel("Floor area, sq ft")).toHaveValue("2400.000");
      await dialog.getByLabel("Name", { exact: true }).fill("Southgate Showroom E2E");
      await dialog.getByLabel("Floor area, sq ft").fill("2500");
      await dialog.getByLabel("Display samples").fill("97");
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" && new URL(response.url()).pathname === `/api-proxy/locations/${sg.id}`,
      );
      await dialog.getByRole("button", { name: "Save location" }).click();
      expect((await saved).status()).toBe(200);
      await expect(page.getByText("Southgate Showroom E2E saved")).toBeVisible();
      await expect(page.getByRole("row", { name: /Southgate Showroom E2E/ })).toBeVisible();

      // 3. The API stored it.
      const after = await southgateOf(dana.request);
      expect(after).toMatchObject({
        name: "Southgate Showroom E2E",
        floorAreaSqFt: "2500.000",
        displaySamples: 97,
        branchId: sg.branchId,
        kind: "showroom",
      });
      const defaults = (await locationsOf(dana.request)).filter((location) => location.isDefault);
      expect(defaults.map((location) => location.name)).toEqual(["Denver Central"]);

      // 4. Priya's quote builder offers the new name.
      await priya.page.goto("/sales/quotes/new");
      await priya.page.getByLabel("Sold at").click();
      await expect(priya.page.getByRole("option", { name: "Southgate Showroom E2E", exact: true })).toBeVisible();
      await priya.page.keyboard.press("Escape");

      // 5. One audit entry for the change.
      const audited = (await auditEntriesBy(dana.request, "Changed location", DANA, since)).filter(
        (entry) => !seen.has(entry.id),
      );
      expect(audited.map((entry) => entry.target)).toEqual(["Southgate Showroom E2E"]);

      // 6. A warehouse with stock stays one.
      await page.getByRole("row", { name: /Colorado Springs/ }).first().click();
      await dialog.getByRole("group", { name: "Type" }).getByRole("button", { name: "Showroom" }).click();
      const refused = page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" && new URL(response.url()).pathname === `/api-proxy/locations/${cs.id}`,
      );
      await dialog.getByRole("button", { name: "Save location" }).click();
      expect((await refused).status()).toBe(400);
      await expect(dialog.getByRole("alert")).toHaveText(HOLDS_STOCK);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect((await springsOf(dana.request)).kind).toBe("warehouse");

      // 7. A new location goes to POST without an id; the test stops it in the browser.
      let posted: unknown = null;
      const stop = async (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
        if (route.request().method() !== "POST") return route.fallback();
        posted = route.request().postDataJSON();
        return route.fulfill({ status: 409, json: { code: "conflict", message: "Stopped by the test." } });
      };
      await page.route(/\/locations(\?.*)?$/, stop);
      await page.getByRole("button", { name: "Add location" }).click();
      await dialog.getByLabel("Name", { exact: true }).fill("E2E Annex");
      await dialog.getByRole("group", { name: "Type" }).getByRole("button", { name: "Showroom" }).click();
      await dialog.getByLabel("Street", { exact: true }).fill("1 Test Way");
      await dialog.getByLabel("City", { exact: true }).fill("Denver");
      await dialog.getByLabel("State", { exact: true }).fill("CO");
      await dialog.getByLabel("ZIP").fill("80202");
      await dialog.getByRole("button", { name: "Save location" }).click();
      await expect(dialog.getByRole("alert")).toHaveText("Stopped by the test.");
      const company = await readAs<{ company: { branches: { id: string }[] } }>(dana.request, "/company");
      expect(posted).not.toBeNull();
      const sent = posted as Record<string, unknown>;
      expect(sent).not.toHaveProperty("id");
      expect(sent).not.toHaveProperty("floorAreaSqFt");
      expect(company.company.branches.map((branch) => branch.id)).toContain(sent.branchId);
      expect(sent).toMatchObject({ displaySamples: 0, isDefault: false });
      await page.unroute(/\/locations(\?.*)?$/, stop);
      await dialog.getByRole("button", { name: "Cancel" }).click();
      expect((await locationsOf(dana.request)).map((location) => location.name)).not.toContain("E2E Annex");

      // 8. Put back through the page.
      await page.getByRole("row", { name: /Southgate Showroom E2E/ }).first().click();
      await dialog.getByLabel("Name", { exact: true }).fill("Southgate Showroom");
      await dialog.getByLabel("Floor area, sq ft").fill("2400");
      await dialog.getByLabel("Display samples").fill("96");
      const back = page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" && new URL(response.url()).pathname === `/api-proxy/locations/${sg.id}`,
      );
      await dialog.getByRole("button", { name: "Save location" }).click();
      expect((await back).status()).toBe(200);
      expect(canonical(await southgateOf(dana.request))).toBe(canonical(healed));
    },
  );

  flowTest("LNE2 What the page doesn't offer, the API refuses", async ({ personas }) => {
    flowTest.setTimeout(120_000);
    const dana = await personas.open(OWNER_EMAIL, { mfa: true });
    const priya = await personas.open(SALES_EMAIL);
    const sg = await southgateOf(dana.request);
    const cs = await springsOf(dana.request);
    personas.onCleanup("put Southgate back", () => restoreOrThrow(dana.request, sg.id, southgate(sg.branchId)));
    personas.onCleanup("put Colorado Springs back", () => restoreOrThrow(dana.request, cs.id, colorado(cs)));
    await restoreOrThrow(dana.request, sg.id, southgate(sg.branchId));
    const before = await locationsOf(dana.request);
    const since = Date.now();
    const seen = new Set((await locationAudits(dana.request, since)).map((entry) => entry.id));
    const denver = before.find((location) => location.name === "Denver Central")!;
    const put = (request: APIRequestContext, id: string, data: object) =>
      request.put(`/api-proxy/locations/${id}`, { data });

    const forbidden = await put(priya.request, sg.id, southgate(sg.branchId));
    expect([forbidden.status(), (await forbidden.json()).code]).toEqual([403, "forbidden"]);
    const moved = await put(dana.request, sg.id, southgate(denver.branchId));
    expect([moved.status(), (await moved.json()).message]).toEqual([400, BRANCH_FIXED]);
    const withId = await put(dana.request, sg.id, { ...southgate(sg.branchId), id: sg.id });
    expect([withId.status(), (await withId.json()).code]).toEqual([400, "invalid_request"]);
    const taken = await put(dana.request, sg.id, { ...southgate(sg.branchId), name: " Denver Central " });
    expect([taken.status(), (await taken.json()).message]).toEqual([
      400,
      "Another location is already called Denver Central.",
    ]);
    const stocked = await put(dana.request, cs.id, { ...colorado(cs), kind: "showroom" });
    expect([stocked.status(), (await stocked.json()).message]).toEqual([400, HOLDS_STOCK]);
    // A demo branch id, with a taken name too, so a broken branch check would still write nothing.
    const demoBranch = await dana.request.post("/api-proxy/locations", {
      data: { ...southgate("sm-br-denver"), name: "Southgate Showroom" },
    });
    expect([demoBranch.status(), (await demoBranch.json()).message]).toEqual([
      400,
      "Choose the branch this location belongs to.",
    ]);

    expect(canonical(await locationsOf(dana.request))).toBe(canonical(before));
    expect((await locationAudits(dana.request, since)).filter((entry) => !seen.has(entry.id))).toEqual([]);
  });
});
