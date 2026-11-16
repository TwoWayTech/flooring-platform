import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import type { Meeting } from "@workspace/shared";
import type { SessionContext } from "@/lib/session/api-context";
import { FLOW_TAG } from "../../e2e/helpers";
import { MANAGER_EMAIL, SALES_EMAIL } from "../accounts";
import { expectAuditRows, expectOutboxSent, notifications, readAs, type InAppNote, type OutboxRow } from "./checks";
import {
  assertSameCompanyDay,
  companyToday,
  flowTest,
  mondayForRun,
  openWeek,
  resetAuthAround,
  runId,
  waitForAnswer,
} from "./kit";

/** What every F6 title starts with, so the sweep cancels only flows' leftovers. */
const TITLE_PREFIX = "e2e-flow meeting ";

/**
 * The guest from outside the company, the same address every run: it counts once a company day
 * against the 50 new outside addresses one person may invite (meetings.md "Volume limits").
 */
const OUTSIDE_GUEST = "e2e-flow-guest@flows.example";

/** The staff guest, as her answer, the drawer and her notes name her. */
const SALES_NAME = "Priya Natarajan";

/** The meeting's start, clear of `meetings.spec.ts`'s 10:00 slot (plan-final.md row 21), and how the week grid shows it. */
const START = { typed: "14:00", shown: "2:00 PM" };

/** Where every meeting note opens (apps/api `MeetingSends`), so a note is told apart by its title. */
const MEETINGS_HREF = "/meetings";

/** The meeting's button in the week grid: its start, then its title. */
function inGrid(page: Page, title: string): Locator {
  return page.getByRole("button", { name: new RegExp(`^${START.shown}.*${title}`) });
}

/** The iTIP method of an Outbox row's calendar file (REQUEST, CANCEL, …), or null when it carries none. */
function icsMethod(row: OutboxRow): string | null {
  const ics = row.attachments.find((a) => a.kind === "ics" && a.fileName.endsWith(".ics"));
  return /^METHOD:([A-Z]+)\r?$/m.exec(ics?.text ?? "")?.[1] ?? null;
}

/**
 * Waits for the meeting's invites whose calendar file holds `METHOD:<method>` to leave the queue
 * (`expectOutboxSent`), and asserts there is exactly one to each guest, each titled with the meeting.
 */
async function expectInvites(request: APIRequestContext, meeting: Meeting, method: string): Promise<void> {
  const rows = await expectOutboxSent(
    request,
    (row) => row.eventKey === "meeting.invite" && row.sourceId === meeting.id && icsMethod(row) === method,
  );
  expect(rows.map((row) => row.recipientEmail.toLowerCase()).sort(), `one ${method} to each guest`).toEqual(
    [OUTSIDE_GUEST, SALES_EMAIL].sort(),
  );
  for (const row of rows) expect(row.subject, `the ${method} to ${row.recipientEmail}`).toContain(meeting.title);
}

/** The person's in-app notes of `eventKey` about the meeting `title`, by the title each note ends with. */
async function notesAbout(request: APIRequestContext, eventKey: string, title: string): Promise<InAppNote[]> {
  return (await notifications(request)).filter((n) => n.eventKey === eventKey && n.title.endsWith(`: ${title}`));
}

/**
 * As Luis, through the product's route: cancels each meeting an earlier run left on, one he
 * organises titled `e2e-flow meeting …`. GET /meetings lists only meetings not cancelled; a 400
 * says one was cancelled in between.
 */
async function sweep(request: APIRequestContext): Promise<void> {
  const me = (await readAs<SessionContext>(request, "/auth/context")).user.id;
  const left = (await readAs<Meeting[]>(request, "/meetings")).filter(
    (m) => m.ownerUserId === me && m.title.startsWith(TITLE_PREFIX),
  );
  for (const m of left) {
    const response = await request.post(`/api-proxy/meetings/${m.id}/cancel`);
    expect([201, 400], `cancel ${m.title}: ${await response.text()}`).toContain(response.status());
  }
}

/**
 * Flow F6 (reduced from demo flow G3-6; plan-final.md section 1): Luis schedules a meeting with
 * Priya and a guest from outside, and each gets an invite with a REQUEST calendar file in the
 * Outbox; Priya accepts in her drawer, and Luis gets her reply by email and in-app; Luis cancels,
 * and each guest gets a CANCEL. The Outbox and the bell are read through the API, since their
 * screens still show DemoStore's rows in api mode. A cancelled meeting, its Outbox rows, notes and
 * audit entries stay.
 */
flowTest.describe("flow F6: meeting invites in the Outbox, an answer and a cancel", () => {
  resetAuthAround([MANAGER_EMAIL, SALES_EMAIL]);

  flowTest(
    "invites reach each guest, a colleague's answer reaches the organiser, and the cancel reaches each guest",
    { tag: FLOW_TAG },
    async ({ personas }) => {
      flowTest.setTimeout(120_000);
      const run = runId();
      const start = companyToday();
      const since = Date.now();
      const title = `${TITLE_PREFIX}${run}`;
      const { day, weeksAhead } = mondayForRun(run);
      const luis = await personas.open(MANAGER_EMAIL);
      const priya = await personas.open(SALES_EMAIL);

      await flowTest.step("0. sweep: cancel an earlier run's meetings", () => sweep(luis.request));

      const { meeting, n0 } = await flowTest.step("1. Luis schedules with Priya and an outside guest", async () => {
        const { page } = luis;
        const before = await notifications(luis.request);
        await openWeek(page, 0);
        await page.getByRole("button", { name: "New meeting" }).click();
        const form = page.getByRole("dialog", { name: "New meeting" });
        await form.getByLabel("Title").fill(title);
        await form.getByLabel("Date").fill(day);
        await form.getByLabel("Start").fill(START.typed);
        const guests = form.getByRole("textbox", { name: "Guests" });
        await guests.fill("Priya");
        await form
          .getByRole("list", { name: "Guest results" })
          .getByRole("button", { name: new RegExp(SALES_NAME) })
          .click();
        await guests.fill(OUTSIDE_GUEST);
        await form.getByRole("button", { name: "Add guest by email" }).click();
        const invited = form.getByRole("list", { name: "Guests invited" });
        await expect(invited).toContainText(SALES_NAME);
        await expect(invited).toContainText(OUTSIDE_GUEST);
        const answer = waitForAnswer<Meeting>(page, "POST", /^\/api-proxy\/meetings$/);
        await form.getByRole("button", { name: "Schedule meeting" }).click();
        const made = await answer;
        personas.onCleanup(`cancel ${title}`, () => luis.request.post(`/api-proxy/meetings/${made.id}/cancel`));
        await expect(page.getByText(`Meeting ${title} scheduled`, { exact: true })).toBeVisible();
        expect(made).toMatchObject({ title, start: `${day}T${START.typed}`, durationMin: 30, status: "confirmed" });
        await expectInvites(luis.request, made, "REQUEST");
        return { meeting: made, n0: before };
      });

      await flowTest.step("2. Priya accepts", async () => {
        const { page } = priya;
        const invitation = await notesAbout(priya.request, "meeting.invite", title);
        expect(invitation.map((n) => [n.title, n.href])).toEqual([[`Invitation: ${title}`, MEETINGS_HREF]]);
        await openWeek(page, weeksAhead);
        await inGrid(page, title).click();
        const drawer = page.getByRole("dialog", { name: title });
        await expect(drawer.getByText("Your answer: No reply yet", { exact: true })).toBeVisible();
        const answer = waitForAnswer<Meeting>(page, "POST", new RegExp(`^/api-proxy/meetings/${meeting.id}/response$`));
        await drawer.getByRole("button", { name: "Accept", exact: true }).click();
        const answered = await answer;
        const mine = answered.attendees.find((a) => a.kind === "staff" && a.name === SALES_NAME);
        expect(mine?.partStat, "Priya's answer as the API stored it").toBe("accepted");
        await expect(drawer.getByText("Your answer: Accepted", { exact: true })).toBeVisible();

        const replies = await expectOutboxSent(
          luis.request,
          (row) => row.eventKey === "meeting.reply" && row.sourceId === meeting.id,
        );
        expect(replies.map((row) => [row.recipientEmail.toLowerCase(), row.subject.includes(title)])).toEqual([
          [MANAGER_EMAIL, true],
        ]);
        const known = new Set(n0.map((n) => n.id));
        const reply = (await notesAbout(luis.request, "meeting.reply", title)).filter((n) => !known.has(n.id));
        expect(reply.map((n) => [n.title, n.href])).toEqual([[`${SALES_NAME} accepted: ${title}`, MEETINGS_HREF]]);
      });

      await flowTest.step("3. Luis sees the answer and cancels", async () => {
        const { page } = luis;
        await openWeek(page, weeksAhead);
        await inGrid(page, title).click();
        const drawer = page.getByRole("dialog", { name: title });
        const attendees = drawer.getByRole("listitem");
        await expect(attendees.filter({ hasText: SALES_NAME })).toContainText("Accepted");
        await expect(attendees.filter({ hasText: OUTSIDE_GUEST })).toContainText("No reply yet");
        const answer = waitForAnswer<Meeting>(page, "POST", new RegExp(`^/api-proxy/meetings/${meeting.id}/cancel$`));
        await drawer.getByRole("button", { name: "Cancel meeting" }).click();
        expect((await answer).status).toBe("cancelled");
        await expect(page.getByText("Meeting cancelled", { exact: true })).toBeVisible();
        await expect(drawer).toHaveCount(0);
        await expect(inGrid(page, title)).toHaveCount(0);
        await expectInvites(luis.request, meeting, "CANCEL");
        const told = await notesAbout(priya.request, "meeting.invite", title);
        expect(told.map((n) => n.title).sort(), "Priya's notes about it: the invitation and the cancel").toEqual([
          `Cancelled: ${title}`,
          `Invitation: ${title}`,
        ]);
      });

      await flowTest.step("4. the audit log", () =>
        expectAuditRows(luis.page, title, ["Scheduled meeting", "Answered meeting", "Cancelled meeting"], since),
      );
      assertSameCompanyDay(start);
    },
  );
});
