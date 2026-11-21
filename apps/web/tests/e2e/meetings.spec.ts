import { expect, test, type Locator, type Page } from "@playwright/test";
import { FLOW_TAG, HARBOR_OWNER, HR_TAG, signInAs, summitDay, SUMMIT_OWNER, type Persona } from "./helpers";

const SUMMIT_SALES: Persona = { companyId: "summit", userId: "sm-usr-03", roleKey: "sales" };
const SUMMIT_HR: Persona = { companyId: "summit", userId: "sm-usr-07", roleKey: "hr" };

test.describe("meetings", () => {
  test("shows this week's recurring meetings with attendees and the reminder", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    await page.getByRole("button", { name: /Weekly sales huddle/ }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer.getByRole("heading", { name: "Weekly sales huddle" })).toBeVisible();
    await expect(drawer.getByText(/^Reminder \d+ minutes before$/)).toBeVisible();
    await expect(drawer.getByText("Every week")).toBeVisible();
    await expect(drawer.getByRole("heading", { name: "Attendees" })).toBeVisible();
  });

  test("schedules a weekly meeting with a supplier that repeats next week", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    await page.getByRole("button", { name: "New meeting" }).click();
    await page.getByLabel("Title").fill("Sample room refresh");
    await page.getByRole("textbox", { name: "Guests" }).fill("Northline");
    await page.getByRole("list", { name: "Guest results" }).getByRole("button").first().click();
    await page.getByLabel("Repeats").click();
    await page.getByRole("option", { name: "Every week" }).click();
    await page.getByRole("button", { name: "Schedule meeting" }).click();
    await expect(page.getByText("Meeting Sample room refresh scheduled")).toBeVisible();

    await page.getByRole("button", { name: "Next week" }).click();
    await page.getByRole("button", { name: /Sample room refresh/ }).click();
    await expect(page.getByRole("dialog").getByText("(supplier)")).toBeVisible();
  });

  test("the HR Suite has its own meetings", { tag: HR_TAG }, async ({ page }) => {
    await signInAs(page, HARBOR_OWNER, "/meetings");
    await expect(page.getByRole("button", { name: /Weekly recruiter standup/ })).toBeVisible();
  });
});

/** "2:00 PM" an hour later. */
function hourLater(time: string): string {
  const [hm, ap] = time.split(" ") as [string, string];
  const [h, m] = hm.split(":").map(Number) as [number, number];
  const h24 = (h % 12) + (ap === "PM" ? 12 : 0) + 1;
  return `${h24 % 12 === 0 ? 12 : h24 % 12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

/** The start time a meeting block shows first, such as "2:00 PM". */
async function startOf(block: Locator): Promise<string> {
  return (await block.innerText()).trim().match(/^\d{1,2}:\d{2} [AP]M/)![0];
}

/** Presses a meeting block at `at` of its height (0 top, 1 bottom) and drags it `dy` pixels down. */
async function drag(page: Page, block: Locator, at: number, dy: number): Promise<void> {
  const box = (await block.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height * at;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + dy / 2, { steps: 4 });
  await page.mouse.move(x, y + dy, { steps: 4 });
  await page.mouse.up();
}

test.describe("meetings calendar (spec F)", () => {
  test(
    "drags a repeating meeting an hour later for this event only, and Undo puts it back (flow 5)",
    { tag: FLOW_TAG },
    async ({ page }) => {
      await signInAs(page, SUMMIT_OWNER, "/meetings");
      const meeting = page.getByRole("button", { name: /Weekly sales huddle/ }).first();
      const before = await startOf(meeting);
      // Grabbed in the lower half of the 30-minute block, which used to resize it (click-through #44).
      await drag(page, meeting, 0.6, 48);
      const ask = page.getByRole("dialog", { name: "Move a repeating meeting" });
      await ask.getByLabel("This event").check();
      await ask.getByRole("button", { name: "Move" }).click();
      await expect(page.getByText("Weekly sales huddle moved")).toBeVisible();
      await expect(
        page.getByRole("button", { name: new RegExp(`^${hourLater(before)}.*Weekly sales huddle.*, 30 minutes`) }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(page.getByText("Move undone")).toBeVisible();
      await expect(page.getByRole("button", { name: new RegExp(`^${before}.*Weekly sales huddle`) })).toBeVisible();
    },
  );

  test("dragging a short block's bottom edge changes its length and says so", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    const meeting = page.getByRole("button", { name: /Weekly sales huddle/ }).first();
    const before = await startOf(meeting);
    // The title shows beside the time on a 30-minute block (#43).
    await expect(meeting).toContainText("Weekly sales huddle");
    await drag(page, meeting, 0.95, 48);
    const ask = page.getByRole("dialog", { name: "Change a repeating meeting's length" });
    await ask.getByLabel("This event").check();
    await ask.getByRole("button", { name: "Change length" }).click();
    await expect(page.getByText("Weekly sales huddle now lasts 90 minutes")).toBeVisible();
    await expect(
      page.getByRole("button", { name: new RegExp(`^${before}.*Weekly sales huddle.*, 90 minutes`) }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Length change undone")).toBeVisible();
    await expect(
      page.getByRole("button", { name: new RegExp(`^${before}.*Weekly sales huddle.*, 30 minutes`) }),
    ).toBeVisible();
  });

  test("reschedules from the form, and shows month and agenda views", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    await page
      .getByRole("button", { name: /Weekly sales huddle/ })
      .first()
      .click();
    const drawer = page.getByRole("dialog", { name: "Weekly sales huddle" });
    await drawer.getByLabel("Start").fill("16:00");
    await drawer.getByRole("button", { name: "Move meeting" }).click();
    await page.getByRole("dialog", { name: "Move a repeating meeting" }).getByRole("button", { name: "Move" }).click();
    await expect(page.getByText("Weekly sales huddle moved")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: /^4:00 PM.*Weekly sales huddle/ })).toBeVisible();

    await page.getByRole("group", { name: "Calendar view" }).getByRole("button", { name: "Month" }).click();
    await expect(page.getByRole("button", { name: "Next month" })).toBeVisible();
    await page.getByRole("group", { name: "Calendar view" }).getByRole("button", { name: "Agenda" }).click();
    await expect(page.getByText(/^Next 30 days from/)).toBeVisible();
  });
});

/** A day as the demo's own YYYY-MM-DD, `n` days from Summit's today in Denver (the app's `today()`). */
function inDays(n: number): string {
  return summitDay(n);
}

/** The first day at least `minDays` from today that falls on `dow` (0 is Sunday). */
function nextWeekday(dow: number, minDays: number): string {
  let n = minDays;
  while (new Date(`${inDays(n)}T12:00:00`).getDay() !== dow) n += 1;
  return inDays(n);
}

/** Opens New meeting on the Meetings page and schedules one, with optional guests, repeat and privacy. */
async function schedule(
  page: Page,
  meeting: { title: string; date: string; start: string; guests?: string[]; weekly?: boolean; private?: boolean },
) {
  await page.getByRole("button", { name: "New meeting" }).click();
  const form = page.getByRole("dialog", { name: "New meeting" });
  await form.getByLabel("Title").fill(meeting.title);
  await form.getByLabel("Date").fill(meeting.date);
  await form.getByLabel("Start").fill(meeting.start);
  for (const guest of meeting.guests ?? []) {
    await form.getByRole("textbox", { name: "Guests" }).fill(guest);
    await form
      .getByRole("list", { name: "Guest results" })
      .getByRole("button", { name: new RegExp(guest) })
      .click();
  }
  if (meeting.weekly) {
    await form.getByLabel("Repeats").click();
    await page.getByRole("option", { name: "Every week" }).click();
  }
  if (meeting.private) await form.getByRole("checkbox", { name: "Private meeting" }).check();
  await form.getByRole("button", { name: "Schedule meeting" }).click();
  await expect(page.getByText(`Meeting ${meeting.title} scheduled`)).toBeVisible();
}

/** Opens a meeting from the Agenda view, which covers the next 30 days. */
async function openInAgenda(page: Page, title: string) {
  await page.getByRole("group", { name: "Calendar view" }).getByRole("button", { name: "Agenda" }).click();
  await page
    .getByRole("button", { name: new RegExp(title) })
    .first()
    .click();
  return page.getByRole("dialog", { name: title });
}

test.describe("meetings on the shared rules (ADR 0051 part 3)", () => {
  test("offers no 'This and following' on a series' first occurrence", async ({ page }) => {
    const title = `First occurrence check ${Date.now().toString(36)}`;
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    await schedule(page, { title, date: nextWeekday(1, 2), start: "10:00", weekly: true });
    const drawer = await openInAgenda(page, title);
    await drawer.getByLabel("Start").fill("11:00");
    await drawer.getByRole("button", { name: "Move meeting" }).click();
    const ask = page.getByRole("dialog", { name: "Move a repeating meeting" });
    await expect(ask.getByRole("radio", { name: "This event" })).toBeVisible();
    await expect(ask.getByRole("radio", { name: "All events" })).toBeVisible();
    await expect(ask.getByRole("radio", { name: "This and following events" })).toHaveCount(0);
    await expect(ask.getByText("This is the first occurrence of the series.")).toBeVisible();
    await ask.getByRole("button", { name: "Cancel" }).click();
  });

  test("offers no 'All events' on an occurrence moved on its own", async ({ page }) => {
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    await page
      .getByRole("button", { name: /Weekly sales huddle/ })
      .first()
      .click();
    const drawer = page.getByRole("dialog", { name: "Weekly sales huddle" });
    await drawer.getByLabel("Start").fill("16:00");
    await drawer.getByRole("button", { name: "Move meeting" }).click();
    const first = page.getByRole("dialog", { name: "Move a repeating meeting" });
    await first.getByLabel("This event").check();
    await first.getByRole("button", { name: "Move" }).click();
    await expect(page.getByText("Weekly sales huddle moved")).toBeVisible();
    // The drawer follows the occurrence it moved, so it is still open on the 4:00 PM one.
    await expect(drawer.getByText(/4:00 PM/)).toBeVisible();
    await drawer.getByLabel("Start").fill("17:00");
    await drawer.getByRole("button", { name: "Move meeting" }).click();
    const ask = page.getByRole("dialog", { name: "Move a repeating meeting" });
    await expect(ask.getByRole("radio", { name: "This event" })).toBeVisible();
    await expect(ask.getByRole("radio", { name: "All events" })).toHaveCount(0);
    await expect(ask.getByText("This occurrence was changed on its own.")).toBeVisible();
  });

  test("moves a one-off twice from its drawer", async ({ page }) => {
    const title = `Twice moved ${Date.now().toString(36)}`;
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    await schedule(page, { title, date: nextWeekday(4, 2), start: "10:00" });
    const drawer = await openInAgenda(page, title);
    await drawer.getByLabel("Start").fill("11:00");
    await drawer.getByRole("button", { name: "Move meeting" }).click();
    await expect(page.getByText(`${title} moved`)).toBeVisible();
    await expect(drawer.getByText(/11:00 AM/)).toBeVisible();
    await drawer.getByLabel("Start").fill("12:00");
    await drawer.getByRole("button", { name: "Move meeting" }).click();
    await expect(drawer.getByText(/12:00 PM/)).toBeVisible();
    await expect(page.getByText("That occurrence is not part of this meeting")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: new RegExp(`12:00 PM.*${title}`) })).toBeVisible();
  });

  test("a conflict with a private meeting the mover can't see reads Busy", async ({ page }) => {
    const run = Date.now().toString(36);
    const day = nextWeekday(2, 2);
    await signInAs(page, SUMMIT_HR, "/meetings");
    await schedule(page, {
      title: `Private review ${run}`,
      date: day,
      start: "15:00",
      guests: ["Bri Alvarez"],
      private: true,
    });
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    await schedule(page, { title: `Busy check ${run}`, date: day, start: "10:00", guests: ["Bri Alvarez"] });
    const drawer = await openInAgenda(page, `Busy check ${run}`);
    await drawer.getByLabel("Start").fill("15:00");
    await drawer.getByRole("button", { name: "Move meeting" }).click();
    const warning = page.getByText(/^Also booked then:/);
    await expect(warning).toContainText("Bri Alvarez (Busy, 3:00 PM)");
    await expect(warning).not.toContainText("Private review");
  });

  test("Undo in a move's warning works from the open drawer, which follows the meeting back", async ({ page }) => {
    const run = Date.now().toString(36);
    const day = nextWeekday(5, 2);
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    await schedule(page, { title: `Clash ${run}`, date: day, start: "15:00", guests: ["Bri Alvarez"] });
    await schedule(page, { title: `Undo check ${run}`, date: day, start: "10:00", guests: ["Bri Alvarez"] });
    const drawer = await openInAgenda(page, `Undo check ${run}`);
    await drawer.getByLabel("Start").fill("15:00");
    await drawer.getByRole("button", { name: "Move meeting" }).click();
    await expect(page.getByText(/^Also booked then:/)).toContainText(`Bri Alvarez (Clash ${run}, 3:00 PM)`);
    await expect(drawer.getByText(/3:00 PM/)).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Move undone")).toBeVisible();
    await expect(drawer.getByText(/10:00 AM/)).toBeVisible();
  });

  test("the drawer follows a series moved with All events or This and following, and back on Undo", async ({
    page,
  }) => {
    const title = `Series follow ${Date.now().toString(36)}`;
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    await schedule(page, { title, date: nextWeekday(1, 2), start: "10:00", weekly: true });
    // The second occurrence, which every scope may move.
    await page.getByRole("group", { name: "Calendar view" }).getByRole("button", { name: "Agenda" }).click();
    await page
      .getByRole("button", { name: new RegExp(title) })
      .nth(1)
      .click();
    const drawer = page.getByRole("dialog", { name: title });
    await expect(drawer.getByText(/10:00 AM/)).toBeVisible();
    for (const scope of ["All events", "This and following events"]) {
      await drawer.getByLabel("Start").fill("11:00");
      await drawer.getByRole("button", { name: "Move meeting" }).click();
      const ask = page.getByRole("dialog", { name: "Move a repeating meeting" });
      await ask.getByLabel(scope).check();
      await ask.getByRole("button", { name: "Move" }).click();
      await expect(page.getByText(`${title} moved`).last()).toBeVisible();
      await expect(drawer.getByText(/11:00 AM/)).toBeVisible();
      await page.getByRole("button", { name: "Undo" }).click();
      await expect(page.getByText("Move undone").last()).toBeVisible();
      await expect(drawer.getByText(/10:00 AM/)).toBeVisible();
    }
  });

  test("someone who may not change a meeting gets no move or edit controls", async ({ page }) => {
    const title = `Controls check ${Date.now().toString(36)}`;
    await signInAs(page, SUMMIT_OWNER, "/meetings");
    await schedule(page, { title, date: nextWeekday(3, 2), start: "10:00", guests: ["Priya Natarajan"] });
    await signInAs(page, SUMMIT_SALES, "/meetings");
    const drawer = await openInAgenda(page, title);
    await expect(drawer.getByRole("button", { name: "Accept", exact: true })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Add to my calendar" })).toBeVisible();
    await expect(drawer.getByRole("button", { name: "Edit details" })).toHaveCount(0);
    await expect(drawer.getByRole("button", { name: "Cancel meeting" })).toHaveCount(0);
    await expect(drawer.getByRole("form", { name: "Reschedule" })).toHaveCount(0);
  });
});
