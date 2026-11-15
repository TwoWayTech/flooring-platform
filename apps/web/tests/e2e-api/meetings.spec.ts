import { expect, test, type Page } from "@playwright/test";
import { MANAGER_EMAIL, SALES_EMAIL, signInAs } from "./accounts";

const DENVER = "America/Denver";
const DAY_MS = 86_400_000;

/**
 * A Monday 8 to 90 days after Denver's today, chosen by the run. Two runs (or a run stopped midway,
 * whose cleanup may come after its context closed) then rarely book the same slot. `weeksAhead` is
 * how many times "Next week" moves from this week to that Monday (ADR 0051 "Part 3", S8).
 */
function mondayForRun(run: string): { day: string; weeksAhead: number } {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: DENVER }).format(new Date());
  const base = new Date(`${today}T00:00:00Z`);
  const thisMonday = base.getTime() - ((base.getUTCDay() + 6) % 7) * DAY_MS;
  const weeksAhead = 2 + (parseInt(run.slice(-3), 36) % 11);
  return { day: new Date(thisMonday + weeksAhead * 7 * DAY_MS).toISOString().slice(0, 10), weeksAhead };
}

/** "Jan 5, 2027": how the company's date format (MMM d, yyyy) shows a day. */
function formatted(day: string): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Opens the Meetings page on the week that holds the run's Monday. */
async function openWeek(page: Page, weeksAhead: number): Promise<void> {
  await page.goto("/meetings");
  await expect(page.getByRole("button", { name: "New meeting" })).toBeVisible();
  for (let i = 0; i < weeksAhead; i += 1) await page.getByRole("button", { name: "Next week" }).click();
}

/** Clicks the button that saves a new meeting and returns the id the API gave it. */
async function schedule(page: Page): Promise<string> {
  const created = page.waitForResponse(
    (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api-proxy/meetings",
  );
  await page.getByRole("button", { name: "Schedule meeting" }).click();
  const body = (await (await created).json()) as { id: string };
  return body.id;
}

/** The meeting's button in the week grid, found by its title. */
function inGrid(page: Page, title: string) {
  return page.getByRole("button", { name: new RegExp(title) });
}

// Meetings part 3 on the real API (docs/product-spec/meetings.md; ADR 0051 "Part 3"): Luis Ortega
// organises with Priya Natarajan as guest, and Priya has a private meeting that Luis may not see.
test.describe("meetings (api mode)", () => {
  test("schedule, Busy, undo, propose, decide, My meetings, hidden settings, cancel", async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(240_000);
    const run = Date.now().toString(36);
    const title = `API meeting ${run}`;
    const hidden = `Private ${run}`;
    const { day, weeksAhead } = mondayForRun(run);
    const made: { id: string; by: "manager" | "sales" }[] = [];
    const priyaContext = await browser.newContext({
      baseURL,
      timezoneId: DENVER,
      viewport: { width: 1440, height: 900 },
    });
    const priya = await priyaContext.newPage();
    try {
      // 1. The manager schedules with Priya; a guest by email is only invited, never saved under a customer.
      await signInAs(page, MANAGER_EMAIL);
      await openWeek(page, 0);
      await page.getByRole("button", { name: "New meeting" }).click();
      const form = page.getByRole("dialog", { name: "New meeting" });
      await form.getByLabel("Title").fill(title);
      await form.getByLabel("Date").fill(day);
      await form.getByLabel("Start").fill("10:00");
      await form.getByRole("textbox", { name: "Guests" }).fill("Priya");
      await form
        .getByRole("list", { name: "Guest results" })
        .getByRole("button", { name: /Priya Natarajan/ })
        .click();
      await expect(form.getByRole("list", { name: "Guests invited" })).toContainText("Priya Natarajan");
      await form.getByRole("textbox", { name: "Guests" }).fill("someone@outside.example");
      await expect(form.getByRole("button", { name: "Add guest by email" })).toBeVisible();
      await expect(form.getByLabel("Save under customer")).toHaveCount(0);
      await form.getByRole("textbox", { name: "Guests" }).fill("");
      made.push({ id: await schedule(page), by: "manager" });
      await expect(page.getByText(`Meeting ${title} scheduled`)).toBeVisible();

      // 2. Priya schedules her private "Busy" slot, finds the meeting without change controls, and proposes a time.
      await signInAs(priya, SALES_EMAIL);
      await openWeek(priya, 0);
      await priya.getByRole("button", { name: "New meeting" }).click();
      const mine = priya.getByRole("dialog", { name: "New meeting" });
      await mine.getByLabel("Title").fill(hidden);
      await mine.getByLabel("Date").fill(day);
      await mine.getByLabel("Start").fill("15:00");
      await mine.getByRole("checkbox", { name: "Private meeting" }).check();
      made.push({ id: await schedule(priya), by: "sales" });
      await expect(priya.getByText(`Meeting ${hidden} scheduled`)).toBeVisible();
      await openWeek(priya, weeksAhead);
      await inGrid(priya, title).first().click();
      const guestDrawer = priya.getByRole("dialog", { name: title });
      await expect(guestDrawer.getByRole("button", { name: "Add to my calendar" })).toBeVisible();
      await expect(guestDrawer.getByRole("button", { name: "Edit details" })).toHaveCount(0);
      await expect(guestDrawer.getByRole("button", { name: "Cancel meeting" })).toHaveCount(0);
      await expect(guestDrawer.getByRole("form", { name: "Reschedule" })).toHaveCount(0);
      await guestDrawer.getByRole("button", { name: "Propose a new time" }).click();
      const propose = priya.getByRole("dialog", { name: "Propose a new time" });
      await propose.getByLabel("Start").fill("16:00");
      await propose.getByRole("button", { name: "Send proposal" }).click();
      await expect(priya.getByText("Proposal sent")).toBeVisible();
      await expect(guestDrawer.getByText("Your answer: Maybe")).toBeVisible();

      // 3. The manager never sees Priya's private meeting; moving onto it warns "Busy", and Undo puts it back.
      await openWeek(page, weeksAhead);
      await expect(inGrid(page, title).first()).toBeVisible();
      await expect(inGrid(page, hidden)).toHaveCount(0);
      await inGrid(page, title).first().click();
      const drawer = page.getByRole("dialog", { name: title });
      await drawer.getByLabel("Start").fill("15:00");
      await drawer.getByRole("button", { name: "Move meeting" }).click();
      await expect(page.getByText(`${title} moved`)).toBeVisible();
      const warning = page.getByText(/^Also booked then:/);
      await expect(warning).toContainText("Priya Natarajan (Busy, 3:00 PM)");
      await expect(warning).not.toContainText(hidden);
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(page.getByText("Move undone")).toBeVisible();
      await expect(drawer.getByText(/10:00 AM/)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(page.getByRole("button", { name: new RegExp(`^10:00 AM.*${title}`) })).toBeVisible();

      // 4. The organiser accepts Priya's proposed time, and the meeting moves.
      await inGrid(page, title).first().click();
      await expect(drawer.getByText(`Proposes ${day} at 16:00`)).toBeVisible();
      await drawer.getByRole("button", { name: "Accept time" }).click();
      await expect(page.getByText("Meeting moved")).toBeVisible();
      await expect(drawer.getByText(/4:00 PM/)).toBeVisible();

      // 5. My meetings lists it with its date and time, and offers Request because there are colleagues to ask.
      await page.goto("/my/meetings");
      await expect(page.getByRole("listitem").filter({ hasText: title })).toContainText(`${formatted(day)} at 16:00`);
      await expect(page.getByRole("button", { name: "Request a meeting" })).toBeVisible();

      // 6. Settings → Meetings is not built on the API yet, so the server answers with the not-found
      // page and nothing of it shows. Inside the app shell Next sends a not-found page with status 200,
      // as it does for any unknown address there, so the check is Next's not-found marker in the page.
      const settings = await page.goto("/settings/meetings");
      expect(await settings?.text()).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
      await expect(page.getByText("You don't have access to this page.")).toBeVisible();
      await expect(page.getByLabel("New guests added by email")).toHaveCount(0);

      // 7. Cleanup through the product: cancelling takes the meeting off the grid and closes the drawer.
      await openWeek(page, weeksAhead);
      await inGrid(page, title).first().click();
      await drawer.getByRole("button", { name: "Cancel meeting" }).click();
      await expect(page.getByText("Meeting cancelled")).toBeVisible();
      await expect(drawer).toHaveCount(0);
      await expect(inGrid(page, title)).toHaveCount(0);
      await openWeek(priya, weeksAhead);
      await inGrid(priya, hidden).first().click();
      await priya.getByRole("dialog", { name: hidden }).getByRole("button", { name: "Cancel meeting" }).click();
      await expect(priya.getByText("Meeting cancelled")).toBeVisible();
    } finally {
      // A run stopped midway leaves its meetings behind; cancel them from the context that made them
      // (a 400 for one already cancelled is fine, and a closed page is ignored).
      for (const { id, by } of made) {
        const who = by === "manager" ? page : priya;
        await who.request.post(`/api-proxy/meetings/${id}/cancel`).catch(() => undefined);
      }
      await priyaContext.close();
    }
  });
});
