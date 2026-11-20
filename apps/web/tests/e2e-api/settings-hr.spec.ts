import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import { HR_MESSAGES, type HrSettings, type SettingsAnswer } from "@workspace/shared";
import { EMPLOYEE_EMAIL, HR_EMAIL, SALES_EMAIL } from "./accounts";
import { auditBy, canonical, confirmStepUp, expectAuditRows, putWithStepUp, readAs } from "./flows/checks";
import { choose, flowTest, resetAuthAround, waitForAnswer } from "./flows/kit";

const ACTION = "Changed hr";

/**
 * Puts Settings → HR back to `value` unless `GET /settings` already answers it, with a step-up
 * (ADR 0059, part 5: every save needs one). Returns the last answer, the read when nothing needed
 * changing.
 */
async function healHr(request: APIRequestContext, value: HrSettings, secret: string): Promise<APIResponse> {
  const read = await request.get("/api-proxy/settings");
  expect(read.status(), `GET /settings answered ${read.status()}: ${await read.text()}`).toBe(200);
  if (canonical(((await read.json()) as SettingsAnswer).hr) === canonical(value)) return read;
  return putWithStepUp(request, secret, "/settings/hr", value);
}

/** `healHr` that throws unless the API answered 200, so a refused restore fails the clean-up. */
async function healHrOrThrow(request: APIRequestContext, value: HrSettings, secret: string): Promise<APIResponse> {
  const response = await healHr(request, value, secret);
  if (response.status() !== 200)
    throw new Error(`Putting HR back answered ${response.status()}: ${await response.text()}`);
  return response;
}

/**
 * Settings part 5 on the API (ADR 0059, part 5): Settings → HR reads and saves through `GET /settings`
 * and `PUT /settings/hr` with a step-up; the employee's screens read what HR saved; the pay frequency
 * stays fixed once a pay period exists; Sales is refused. Each test takes Summit's section as it finds
 * it and puts it back as its last step, with a clean-up that repeats the restore.
 */
flowTest.describe("Settings → HR on the API (api mode)", () => {
  resetAuthAround([HR_EMAIL, EMPLOYEE_EMAIL, SALES_EMAIL]);

  flowTest(
    "E1 HR saves a switch and a holiday with a step-up; the employee reads them; a refused value says why before any code",
    async ({ personas }) => {
      flowTest.setTimeout(150_000);
      const tamara = await personas.open(HR_EMAIL, { mfa: true });
      const bri = await personas.open(EMPLOYEE_EMAIL);
      const secret = tamara.secret!;
      const original = (await readAs<SettingsAnswer>(tamara.request, "/settings")).hr;
      expect(original, "Summit's seeded Settings → HR").toBeDefined();
      personas.onCleanup("put Settings → HR back", () => healHrOrThrow(tamara.request, original!, secret));
      const since = Date.now();
      const audited = await auditBy(tamara.request, ACTION, "Tamara Reyes", since);

      // 1. A holiday date listed twice is refused with the shared words, and no code is asked for.
      await tamara.page.goto("/settings/hr");
      const day = original!.holidays[0]!;
      await tamara.page.getByLabel("Holiday date").fill(day.date);
      await tamara.page.getByLabel("Holiday name").fill("Again");
      await tamara.page.getByRole("button", { name: "Add holiday" }).click();
      await tamara.page.getByRole("button", { name: "Save hr" }).click();
      await expect(tamara.page.getByText(HR_MESSAGES.holidayTwice)).toBeVisible();
      await expect(tamara.page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0);

      // 2. Discard, flip "Show who is out", save with a code.
      await tamara.page.getByRole("button", { name: "Discard" }).click();
      const toggle = tamara.page.getByLabel("Show who is out to employees");
      await toggle.click();
      const saved = tamara.page.waitForResponse(
        (response) =>
          response.request().method() === "PUT" && new URL(response.url()).pathname === "/api-proxy/settings/hr",
      );
      await tamara.page.getByRole("button", { name: "Save hr" }).click();
      await confirmStepUp(tamara.page, secret);
      expect((await saved).status()).toBe(200);
      await expect(tamara.page.getByText("HR saved")).toBeVisible();
      const flipped = !original!.showTeamCalendarToEmployees;

      // 3. After a reload the page reads it from the API.
      await tamara.page.reload();
      await expect(tamara.page.getByLabel("Show who is out to employees")).toHaveAttribute(
        "aria-checked",
        String(flipped),
      );

      // 4. Bri, an employee, reads the section (her team calendar's week), and can't save it.
      const answer = waitForAnswer<SettingsAnswer>(bri.page, "GET", /^\/api-proxy\/settings$/);
      await bri.page.goto("/my/time-off");
      expect((await answer).hr?.showTeamCalendarToEmployees).toBe(flipped);
      const denied = await bri.request.put("/api-proxy/settings/hr", { data: original });
      expect(denied.status()).toBe(403);
      expect((await denied.json()).code).toBe("forbidden");

      // 5. Put back; two saves audited as Tamara, on screen too.
      expect((await healHrOrThrow(tamara.request, original!, secret)).status()).toBe(200);
      expect(await auditBy(tamara.request, ACTION, "Tamara Reyes", since)).toBe(audited + 2);
      await expectAuditRows(tamara.page, "HR", [ACTION], since);
    },
  );

  flowTest(
    "E2 once a pay period exists the pay frequency is fixed, on screen and on the API; Sales can't save HR",
    async ({ personas }) => {
      flowTest.setTimeout(150_000);
      const tamara = await personas.open(HR_EMAIL, { mfa: true });
      const priya = await personas.open(SALES_EMAIL);
      const secret = tamara.secret!;
      const original = (await readAs<SettingsAnswer>(tamara.request, "/settings")).hr!;
      personas.onCleanup("put Settings → HR back", () => healHrOrThrow(tamara.request, original, secret));
      const since = Date.now();
      const audited = await auditBy(tamara.request, ACTION, "Tamara Reyes", since);

      // 0. Today's pay period exists (opening it is safe to repeat; the Pay periods page does it on load).
      const opened = await tamara.request.post("/api-proxy/pay-periods", { data: {} });
      expect(opened.status(), await opened.text()).toBeLessThan(300);

      // 1. On screen: another frequency is refused after the code, with the lock's words.
      await tamara.page.goto("/settings/hr");
      const other = original.payFrequency === "weekly" ? "Every two weeks" : "Weekly";
      await choose(tamara.page, tamara.page.getByLabel("Pay frequency"), other);
      await tamara.page.getByRole("button", { name: "Save hr" }).click();
      await confirmStepUp(tamara.page, secret);
      await expect(tamara.page.getByText(HR_MESSAGES.scheduleLocked)).toBeVisible();

      // 2. On the API: the anchor and the workweek too (409), and nothing was stored.
      const refusals: [Partial<HrSettings>, string][] = [
        [{ payPeriodAnchor: "2026-01-05" }, HR_MESSAGES.scheduleLocked],
        [{ workweekStartDay: (original.workweekStartDay + 1) % 7 }, HR_MESSAGES.workweekLocked],
      ];
      for (const [patch, message] of refusals) {
        const refused = await putWithStepUp(tamara.request, secret, "/settings/hr", { ...original, ...patch });
        expect(refused.status()).toBe(409);
        expect(await refused.json()).toEqual({ code: "conflict", message });
      }
      expect(canonical((await readAs<SettingsAnswer>(tamara.request, "/settings")).hr)).toBe(canonical(original));
      expect(await auditBy(tamara.request, ACTION, "Tamara Reyes", since)).toBe(audited);

      // 3. Sales reads the section (her own timesheet's week) and can't save it; no HR page in her menu.
      const denied = await priya.request.put("/api-proxy/settings/hr", { data: original });
      expect(denied.status()).toBe(403);
      expect((await denied.json()).code).toBe("forbidden");
      expect((await readAs<SettingsAnswer>(priya.request, "/settings")).hr).toBeDefined();
      await priya.page.goto("/settings");
      await expect(priya.page.getByRole("link", { name: "HR", exact: true })).toHaveCount(0);
    },
  );
});
