import { expect, type APIRequestContext, type APIResponse, type Page } from "@playwright/test";
import type { CompanyAnswer, PermissionKey, Product, PurchaseOrder, Role, User } from "@workspace/shared";
import {
  DISABLED_EMAIL,
  MANAGER_EMAIL,
  nextCode,
  OWNER_EMAIL,
  SALES_EMAIL,
  seedPassword,
  WAREHOUSE_EMAIL,
} from "./accounts";
import { putWithStepUp, readAs, stepUp } from "./flows/checks";
import { COMPANY_ZONE, flowTest, resetAuthAround, waitForAnswer } from "./flows/kit";

/** The fields `PUT /roles/:id` takes, as recorded before the test changes a role. */
type RoleBody = Pick<Role, "name" | "description" | "dataScope" | "permissions">;

const QUOTE_CREATE: PermissionKey = "sales.quote.create";
const ORDER_VIEW: PermissionKey = "purchasing.order.view";
const PRODUCT_COST: PermissionKey = "inventory.product.view_sensitive";

/** The two ways a screen fails: its data didn't load, or it threw while rendering. */
function failures(page: Page) {
  return page.getByText("This page could not load its data.").or(page.getByText("This screen stopped working."));
}

/** The body `PUT /roles/:id` takes for `role` with exactly `permissions`. */
function bodyOf(role: RoleBody, permissions: readonly PermissionKey[]): RoleBody {
  return { name: role.name, description: role.description, dataScope: role.dataScope, permissions: [...permissions] };
}

/** `text` as a regular expression that matches it literally. */
function literally(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

/** `PUT /roles/:id` as the Owner, stepping up again once when the last step-up is too old. */
function putRole(request: APIRequestContext, secret: string, id: string, body: RoleBody): Promise<APIResponse> {
  return putWithStepUp(request, secret, `/roles/${id}`, body);
}

/**
 * The shell on the real API (ADR 0051, "GET /company"; spec settings-and-permissions.md, Real build,
 * "The shell on the API"): buttons and menus follow `GET /company`'s answer, which is the guard's own
 * access, not DemoStore's roles. Each test signs its people in through the real login page in
 * contexts it owns, and resets their sign-in state around its own describe.
 */
flowTest.describe("the company shell from GET /company (api mode)", () => {
  flowTest.describe("buttons follow the API", () => {
    resetAuthAround([OWNER_EMAIL, MANAGER_EMAIL, SALES_EMAIL]);

    flowTest("E1 the shell's buttons follow the API's answer, not the demo's roles (R1)", async ({ personas }) => {
      flowTest.setTimeout(180_000);
      // 0. Dana steps up and records Sales and Manager, healing only the keys this test changes.
      const dana = await personas.open(OWNER_EMAIL, { mfa: true });
      const secret = dana.secret!;
      await stepUp(dana.request, secret);
      const roles = await readAs<Role[]>(dana.request, "/roles");
      const sales = roles.find((role) => role.key === "sales")!;
      const manager = roles.find((role) => role.key === "manager")!;
      const salesKeys = [...sales.permissions.filter((key) => key !== ORDER_VIEW), QUOTE_CREATE].filter(
        (key, at, all) => all.indexOf(key) === at,
      );
      const managerKeys = manager.permissions.includes(PRODUCT_COST)
        ? manager.permissions
        : [...manager.permissions, PRODUCT_COST];
      const restore = (role: Role, keys: readonly PermissionKey[]) => () =>
        putRole(dana.request, secret, role.id, bodyOf(role, keys));
      personas.onCleanup("put Sales back", restore(sales, salesKeys));
      personas.onCleanup("put Manager back", restore(manager, managerKeys));
      for (const [role, keys] of [
        [sales, salesKeys],
        [manager, managerKeys],
      ] as const) {
        if (keys.length !== role.permissions.length || keys.some((key) => !role.permissions.includes(key)))
          expect((await restore(role, keys)()).status(), `healing ${role.name}`).toBe(200);
      }

      // 1. On the API only: Sales loses New quote and gains purchase orders; Manager loses product cost.
      const salesChanged = [...salesKeys.filter((key) => key !== QUOTE_CREATE), ORDER_VIEW];
      expect((await putRole(dana.request, secret, sales.id, bodyOf(sales, salesChanged))).status()).toBe(200);
      const managerChanged = managerKeys.filter((key) => key !== PRODUCT_COST);
      expect((await putRole(dana.request, secret, manager.id, bodyOf(manager, managerChanged))).status()).toBe(200);

      // 2. Priya's buttons follow the API's answer: no New quote, and Purchasing is there and works.
      const priya = await personas.open(SALES_EMAIL);
      const answered = waitForAnswer<CompanyAnswer>(priya.page, "GET", /^\/api-proxy\/company$/);
      await priya.page.goto("/sales");
      await expect(priya.page.getByRole("heading", { name: "Sales" })).toBeVisible();
      await expect(priya.page.getByRole("link", { name: "New quote" })).toHaveCount(0);
      const answer = await answered;
      expect(answer.access.permissions).not.toContain(QUOTE_CREATE);
      expect(answer.access.permissions).toContain(ORDER_VIEW);
      await priya.page.keyboard.press("ControlOrMeta+k");
      await priya.page.getByPlaceholder("Search or run a command").fill("New quote");
      await expect(priya.page.getByRole("option", { name: "New quote" })).toHaveCount(0);
      await priya.page.keyboard.press("Escape");
      const refused = await priya.request.post("/api-proxy/quotes", { data: {} });
      expect(refused.status()).toBe(403);
      expect((await refused.json()).code).toBe("forbidden");
      const orders = waitForAnswer<PurchaseOrder[]>(priya.page, "GET", /^\/api-proxy\/purchase-orders$/);
      await priya.page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Purchasing" }).click();
      await orders;
      await expect(priya.page.getByRole("heading", { name: "Purchasing" })).toBeVisible();
      await expect(failures(priya.page)).toHaveCount(0);

      // 3. Luis without product cost: no cost reaches his browser, none shows and nothing crashes (D19).
      const luis = await personas.open(MANAGER_EMAIL);
      const products = waitForAnswer<Product[]>(luis.page, "GET", /^\/api-proxy\/products$/);
      await luis.page.goto("/inventory?view=products");
      const catalog = await products;
      expect(catalog.length).toBeGreaterThan(0);
      expect(catalog.filter((product) => "cost" in product).length, "products carrying cost").toBe(0);
      await expect(luis.page.getByRole("button", { name: "Price, column options" })).toBeVisible();
      await expect(luis.page.getByRole("button", { name: "Cost, column options" })).toHaveCount(0);
      await luis.page.getByPlaceholder("Search products").fill(catalog[0].name);
      await luis.page
        .getByRole("row", { name: literally(catalog[0].name) })
        .first()
        .click();
      const drawer = luis.page.getByRole("dialog");
      await expect(drawer.locator("dt", { hasText: /^Price$/ })).toBeVisible();
      await expect(drawer.locator("dt", { hasText: /^Cost$/ })).toHaveCount(0);
      await expect(failures(luis.page)).toHaveCount(0);

      // 4. Dana puts both back, and Priya's New quote returns.
      expect((await restore(sales, salesKeys)()).status()).toBe(200);
      expect((await restore(manager, managerKeys)()).status()).toBe(200);
      await priya.page.goto("/sales");
      await expect(priya.page.getByRole("link", { name: "New quote" }).first()).toBeVisible();
    });
  });

  flowTest.describe("the Owner's shell", () => {
    resetAuthAround([OWNER_EMAIL]);

    flowTest(
      "E2 the Owner's shell in api mode: no View as, no Your profile, the API's branches",
      async ({ personas }) => {
        const dana = await personas.open(OWNER_EMAIL, { mfa: true });
        const { page } = dana;
        // A View as choice left in this tab never applies in api mode.
        await page.addInitScript(() => sessionStorage.setItem("fp-view-as:summit", "sm-role-sales"));
        const answered = waitForAnswer<CompanyAnswer>(page, "GET", /^\/api-proxy\/company$/);
        await page.goto("/settings/users");
        await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
        await expect(page.getByRole("status").filter({ hasText: "Viewing as" })).toHaveCount(0);
        await expect(page.getByText("View as", { exact: true })).toHaveCount(0);
        await page.keyboard.press("ControlOrMeta+k");
        await page.getByPlaceholder("Search or run a command").fill("View as");
        await expect(page.getByRole("option", { name: /^View as / })).toHaveCount(0);
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Account: Dana Whitfield" }).click();
        await expect(page.getByRole("menuitem", { name: "Sign out" })).toBeVisible();
        await expect(page.getByRole("menuitem", { name: "Your profile" })).toHaveCount(0);
        await page.keyboard.press("Escape");

        // Settings → Users names the API's branches.
        await expect(page.getByRole("row", { name: /Priya Natarajan/ }).first()).toContainText("Denver");
        await expect(page.getByRole("row", { name: /Cole Brennan/ }).first()).toContainText("Colorado Springs");
        const denver = (await answered).company.branches.find((branch) => branch.name === "Denver");
        expect(denver?.id, "Denver in GET /company's branches").toMatch(/^[0-9a-f-]{36}$/);

        // The invite starts at Dana's own branch and sends its live id; the test stops it before the API.
        const invite: { sent: { branchId?: string } | null } = { sent: null };
        await page.route("**/api-proxy/users/invite", async (route) => {
          invite.sent = route.request().postDataJSON() as { branchId?: string };
          await route.fulfill({
            status: 409,
            contentType: "application/json",
            body: JSON.stringify({ code: "conflict", message: "Stopped by the test." }),
          });
        });
        await page.getByRole("button", { name: "Invite user" }).click();
        const dialog = page.getByRole("dialog", { name: "Invite user" });
        const branch = dialog.getByLabel("Branch");
        await expect(branch).toHaveText("Denver");
        await branch.click();
        await expect(page.getByRole("option")).toHaveText(["Colorado Springs", "Denver"]);
        await page.keyboard.press("Escape");
        await dialog.getByLabel("Name").fill("E2E Branch Check");
        await dialog.getByLabel("Email").fill("e2e-branch-check@example.test");
        await dialog.getByRole("checkbox", { name: /^Sales/ }).check();
        await dialog.getByRole("button", { name: "Send invitation" }).click();
        await page.getByLabel("Authenticator code").fill(nextCode(dana.secret!));
        await page.getByRole("button", { name: "Confirm" }).click();
        await expect(page.getByText("Stopped by the test.")).toBeVisible();
        expect(invite.sent?.branchId, "the invite's branch").toBe(denver!.id);
        await page.keyboard.press("Escape");

        // Settings → Locations reads the API's locations and the shell's branches since part 4a
        // (ADR 0059): the Branch cell, matched exactly, since the name and City cells say Denver too.
        await page.goto("/settings/locations");
        await expect(
          page
            .getByRole("row", { name: /Denver Central/ })
            .first()
            .getByRole("cell", { name: "Denver", exact: true }),
        ).toBeVisible();
      },
    );
  });

  flowTest.describe("new documents", () => {
    resetAuthAround([SALES_EMAIL, WAREHOUSE_EMAIL]);

    flowTest("E3 new documents start from the person's showroom and warehouse", async ({ personas }) => {
      const priya = await personas.open(SALES_EMAIL);
      await priya.page.goto("/sales/quotes/new");
      await expect(priya.page.getByLabel("Sold at")).toContainText("Summit Design Studio");
      await expect(priya.page.getByLabel("Fulfilled from")).toContainText("Denver Central");

      const cole = await personas.open(WAREHOUSE_EMAIL);
      await cole.page.goto("/inventory?view=transfers");
      await cole.page.getByRole("button", { name: "New transfer" }).click();
      const dialog = cole.page.getByRole("dialog", { name: "New transfer" });
      await expect(dialog.getByLabel("From", { exact: true })).toContainText("Colorado Springs");
      await cole.page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    });
  });

  flowTest.describe("a disabled member", () => {
    resetAuthAround([OWNER_EMAIL, DISABLED_EMAIL]);

    flowTest("E4 a disabled member sees the API's refusal and can sign out", async ({ personas, browser, baseURL }) => {
      flowTest.setTimeout(150_000);
      const dana = await personas.open(OWNER_EMAIL, { mfa: true });
      const victor = (await readAs<User[]>(dana.request, "/users")).find((user) => user.email === DISABLED_EMAIL);
      expect(victor?.status, "the seed keeps Victor Sims disabled").toBe("disabled");

      const context = await browser.newContext({ baseURL, timezoneId: COMPANY_ZONE, reducedMotion: "reduce" });
      try {
        const page = await context.newPage();
        const heading = page.getByRole("heading", { name: "Your workspace could not open" });
        for (let attempt = 0; attempt < 2; attempt += 1) {
          await page.goto("/login");
          await page.getByLabel("Email").fill(DISABLED_EMAIL);
          await page.getByLabel("Password").fill(seedPassword());
          await page.getByRole("button", { name: "Sign in", exact: true }).click();
          const limited = page.getByText("Too many attempts from this network.");
          await expect(heading.or(limited)).toBeVisible();
          if (await heading.isVisible()) break;
          await page.waitForTimeout(61_000);
        }
        await expect(heading).toBeVisible();
        await expect(
          page.getByText("Your role does not allow this. Ask an Owner to change your security role."),
        ).toBeVisible();
        await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(0);
        await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
        await page.getByRole("button", { name: "Sign out" }).click();
        await expect(page).toHaveURL(/\/login$/);
        await expect(page.getByLabel("Email")).toBeVisible();
        await page.goto("/");
        await expect(page).toHaveURL(/\/login$/);
      } finally {
        await context.close();
      }
    });
  });
});
