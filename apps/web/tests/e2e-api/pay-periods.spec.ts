import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import type { PayPeriod } from "@workspace/shared";
import type { PayPeriodReview } from "../../src/lib/api/contract";
import { OWNER_EMAIL } from "./accounts";
import { confirmStepUp, stepUp } from "./flows/checks";
import { flowTest, resetAuthAround, waitForAnswer } from "./flows/kit";

/**
 * Puts a pay period back in review when the test left it approved: a reopen, with its step-up.
 * Returns the reopen's answer, or the list read when nothing needed reopening.
 */
async function reopenIfApproved(request: APIRequestContext, id: string, secret: string): Promise<APIResponse> {
  const listed = await request.get("/api-proxy/pay-periods");
  const period = ((await listed.json()) as PayPeriod[]).find((p) => p.id === id);
  if (period?.status !== "approved") return listed;
  await stepUp(request, secret);
  const reopened = await request.post(`/api-proxy/pay-periods/${id}/reopen`, { data: {} });
  if (reopened.status() !== 201) throw new Error(`Reopening answered ${reopened.status()}: ${await reopened.text()}`);
  return reopened;
}

/**
 * Approving and reopening a pay period on the API (owner's decision 4, ADR 0061; ADR 0063; click-
 * through #47): each asks for a fresh authenticator code, the API refuses either without one, and
 * after approving the page stays on the approved period, so Export for payroll is right there.
 * Summit's seeded run in review is approved and reopened, so the test leaves it as it found it.
 */
flowTest.describe("Pay periods on the API (api mode)", () => {
  resetAuthAround([OWNER_EMAIL]);

  flowTest(
    "PP1 approving and reopening ask for a code; the approved period stays chosen with Export for payroll",
    async ({ personas }) => {
      flowTest.setTimeout(150_000);
      const dana = await personas.open(OWNER_EMAIL, { mfa: true });
      const secret = dana.secret!;

      // 0. The page opens on the run in review; it has nothing left to approve first.
      const listed = waitForAnswer<PayPeriod[]>(dana.page, "GET", /^\/api-proxy\/pay-periods$/);
      const reviewed = waitForAnswer<PayPeriodReview>(dana.page, "GET", /^\/api-proxy\/pay-periods\/[^/]+\/review$/);
      await dana.page.goto("/hr/pay-periods");
      await listed;
      const review = await reviewed;
      const period = review.period;
      expect(period.status, "Summit's seeded run is in review").toBe("in_review");
      expect(review.blockers, "Summit's run in review has every timesheet approved").toEqual([]);
      personas.onCleanup("put the run back in review", () => reopenIfApproved(dana.request, period.id, secret));
      const picker = dana.page.getByRole("combobox", { name: "Pay period" });
      const chosen = (await picker.textContent()) ?? "";

      // 1. Without a code the API refuses approving, and nothing changes.
      const refused = await dana.request.post(`/api-proxy/pay-periods/${period.id}/approve`, { data: {} });
      expect([refused.status(), (await refused.json()).code]).toEqual([403, "step_up_required"]);

      // 2. On screen, Approve asks for a code first; once given, the run is approved and stays chosen.
      await dana.page.getByRole("button", { name: "Approve pay period" }).click();
      await expect(dana.page.getByRole("dialog", { name: "Confirm it is you" })).toContainText(
        "Approving this pay period needs a fresh code",
      );
      const approved = dana.page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `/api-proxy/pay-periods/${period.id}/approve`,
      );
      await confirmStepUp(dana.page, secret);
      expect((await approved).status()).toBe(201);
      await expect(dana.page.getByText("Pay period approved")).toBeVisible();
      await expect(picker).toHaveText(chosen);
      await expect(dana.page.getByText("Approved", { exact: true })).toBeVisible();
      await expect(dana.page.getByRole("button", { name: "Export for payroll" })).toBeVisible();

      // 3. Reopen asks for a code too, and puts the run back in review on the same period.
      await dana.page.getByRole("button", { name: "Reopen" }).click();
      await expect(dana.page.getByRole("dialog", { name: "Confirm it is you" })).toContainText(
        "Reopening this pay period needs a fresh code",
      );
      const reopened = dana.page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === `/api-proxy/pay-periods/${period.id}/reopen`,
      );
      await confirmStepUp(dana.page, secret);
      expect((await reopened).status()).toBe(201);
      await expect(dana.page.getByText("Back in review")).toBeVisible();
      await expect(picker).toHaveText(chosen);
      await expect(dana.page.getByRole("button", { name: "Approve pay period" })).toBeVisible();
    },
  );
});
