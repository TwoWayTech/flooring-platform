import { expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import type { EmailSettings, Meeting, SettingsAnswer } from "@workspace/shared";
import type { SessionContext } from "@/lib/session/api-context";
import { MANAGER_EMAIL, OWNER_EMAIL, SALES_EMAIL } from "./accounts";
import {
  auditBy,
  canonical,
  confirmStepUp,
  expectAuditRows,
  notifications,
  putWithStepUp,
  readAs,
  type OutboxRow,
} from "./flows/checks";
import { flowTest, mondayForRun, resetAuthAround, runId } from "./flows/kit";

const ACTION = "Changed email and notifications";
/** The shared rule's words for a bad reply-to (`EMAIL_MESSAGES.replyTo`), written out as a person reads them. */
const REPLY_TO_WORDS = "Enter the reply-to address as name@example.com, or leave it empty.";
/** The demo's banner, which api mode leaves out: the API's email provider really sends. */
const DEMO_BANNER = "This demo never sends real email.";

/**
 * Puts Settings → Email back to `value` unless `GET /settings` already answers it, with a step-up
 * (every save needs one). Throws unless the API answered 200, so a refused restore fails the clean-up.
 */
async function healEmail(request: APIRequestContext, value: EmailSettings, secret: string): Promise<APIResponse> {
  const read = await request.get("/api-proxy/settings");
  expect(read.status(), `GET /settings answered ${read.status()}: ${await read.text()}`).toBe(200);
  if (canonical(((await read.json()) as SettingsAnswer).email) === canonical(value)) return read;
  const response = await putWithStepUp(request, secret, "/settings/email", value);
  if (response.status() !== 200)
    throw new Error(`Putting Settings → Email back answered ${response.status()}: ${await response.text()}`);
  return response;
}

/**
 * The bell, the Outbox and Settings → Email on the API (ADR 0059, the bell and Outbox part): the
 * screens read the API's notes and rows, a private meeting's rows are redacted in the whole
 * company's Outbox, and the sender details save with a step-up. Each test leaves Summit as it
 * found it: the meeting is cancelled and the sender details are put back.
 */
flowTest.describe("the bell, the Outbox and Settings → Email on the API (api mode)", () => {
  flowTest.describe("the bell and the Outbox", () => {
    resetAuthAround([OWNER_EMAIL, MANAGER_EMAIL, SALES_EMAIL]);

    flowTest(
      "N1 a private meeting's invite reaches Priya's bell and Outbox from the API; Mark all read saves; the Owner sees the rows redacted",
      async ({ personas }) => {
        flowTest.setTimeout(150_000);
        const run = runId();
        const title = `e2e-bell ${run}`;
        const { day } = mondayForRun(run);
        const luis = await personas.open(MANAGER_EMAIL);
        const priya = await personas.open(SALES_EMAIL);
        const priyaId = (await readAs<SessionContext>(priya.request, "/auth/context")).user.id;

        // 0. Luis schedules a private meeting with Priya through the product's route.
        const created = await luis.request.post("/api-proxy/meetings", {
          data: {
            title,
            start: `${day}T16:30`,
            durationMin: 30,
            location: "",
            notes: "",
            recurrence: "none",
            reminderMin: 15,
            private: true,
            hideGuestList: false,
            guests: [{ kind: "staff", id: priyaId }],
            newGuests: [],
          },
        });
        expect(created.status(), await created.text()).toBe(201);
        const meeting = (await created.json()) as Meeting;
        personas.onCleanup(`cancel ${title}`, () => luis.request.post(`/api-proxy/meetings/${meeting.id}/cancel`));

        // 1. Priya's bell lists the API's note; Mark all read reaches the API.
        await expect
          .poll(async () => (await notifications(priya.request)).some((n) => n.title === `Invitation: ${title}`))
          .toBe(true);
        await priya.page.goto("/");
        await priya.page.getByRole("button", { name: /^Notifications/ }).click();
        await expect(priya.page.getByRole("link", { name: `Invitation: ${title}` })).toBeVisible();
        const marked = priya.page.waitForResponse(
          (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api-proxy/notifications/read",
        );
        await priya.page.getByRole("button", { name: "Mark all read" }).click();
        expect((await marked).status()).toBeLessThan(300);
        const note = (await notifications(priya.request)).find((n) => n.title === `Invitation: ${title}`);
        expect(note?.readAt, "the note is read on the API").not.toBeNull();

        // 2. Priya's own Outbox lists her invite whole, from the API, without the demo's banner.
        await priya.page.goto("/outbox");
        await expect(priya.page.getByRole("heading", { name: "Outbox" })).toBeVisible();
        await expect(priya.page.getByText(`Invitation: ${title}`).first()).toBeVisible();
        await expect(priya.page.getByText(DEMO_BANNER)).toHaveCount(0);

        // 3. The Owner's whole-company Outbox has the invite, redacted: the meeting is private.
        const dana = await personas.open(OWNER_EMAIL, { mfa: true });
        // Priya, its guest, reads her invite whole; its ids find it in the Owner's view, where a redacted
        // row keeps no source id.
        const hers = (await readAs<OutboxRow[]>(priya.request, "/outbox")).filter(
          (row) => row.sourceId === meeting.id && row.eventKey === "meeting.invite",
        );
        expect(hers.length, "Priya's invite is in her own Outbox").toBeGreaterThan(0);
        const ids = new Set(hers.map((row) => row.id));
        const rows = await readAs<OutboxRow[]>(dana.request, "/outbox?all=true");
        const invites = rows.filter((row) => ids.has(row.id));
        expect(invites.length, "the invite is in the whole company's Outbox").toBe(ids.size);
        for (const row of invites)
          expect([row.subject, row.attachments, row.sourceId]).toEqual(["Restricted message", [], ""]);
        expect(rows.some((row) => row.sourceId === meeting.id)).toBe(false);
        // Her own Outbox leaves another's rows out, whatever she holds.
        const own = await readAs<OutboxRow[]>(dana.request, "/outbox");
        expect(own.some((row) => ids.has(row.id))).toBe(false);
        await dana.page.goto("/settings/outbox");
        await expect(dana.page.getByRole("cell", { name: "Restricted message" }).first()).toBeVisible();
        await expect(dana.page.getByText(title)).toHaveCount(0);

        // 4. Luis cancels it; the clean-up repeats this safely.
        const cancelled = await luis.request.post(`/api-proxy/meetings/${meeting.id}/cancel`);
        expect(cancelled.status(), await cancelled.text()).toBe(201);
      },
    );
  });

  flowTest.describe("Settings → Email", () => {
    resetAuthAround([OWNER_EMAIL, SALES_EMAIL]);

    flowTest(
      "N2 the Owner saves the sender with a step-up; a bad reply-to says why before any code; Sales can't save it",
      async ({ personas }) => {
        flowTest.setTimeout(150_000);
        const dana = await personas.open(OWNER_EMAIL, { mfa: true });
        const priya = await personas.open(SALES_EMAIL);
        const secret = dana.secret!;
        const original = (await readAs<SettingsAnswer>(dana.request, "/settings")).email;
        expect(original, "Summit's seeded Settings → Email").toBeDefined();
        personas.onCleanup("put Settings → Email back", () => healEmail(dana.request, original!, secret));
        const since = Date.now();
        const audited = await auditBy(dana.request, ACTION, "Dana Whitfield", since);

        // 1. A reply-to that isn't an address is refused with the shared words, and no code is asked for.
        await dana.page.goto("/settings/notifications");
        await expect(dana.page.getByText(DEMO_BANNER)).toHaveCount(0);
        const replyTo = dana.page.getByLabel("Reply-to address");
        await replyTo.fill("office");
        await dana.page.getByRole("button", { name: "Save sender" }).click();
        await expect(dana.page.getByText(REPLY_TO_WORDS)).toBeVisible();
        await expect(dana.page.getByRole("dialog", { name: "Confirm it is you" })).toHaveCount(0);

        // 2. A real address saves after the code.
        const next = `billing+${runId()}@summitfloor.example`;
        await replyTo.fill(next);
        const saved = dana.page.waitForResponse(
          (r) => r.request().method() === "PUT" && new URL(r.url()).pathname === "/api-proxy/settings/email",
        );
        await dana.page.getByRole("button", { name: "Save sender" }).click();
        await confirmStepUp(dana.page, secret);
        expect((await saved).status()).toBe(200);
        await expect(dana.page.getByText("Sender saved")).toBeVisible();

        // 3. After a reload the page reads it from the API.
        await dana.page.reload();
        await expect(dana.page.getByLabel("Reply-to address")).toHaveValue(next);
        expect((await readAs<SettingsAnswer>(dana.request, "/settings")).email?.replyTo).toBe(next);

        // 4. Priya neither reads nor saves it.
        expect(await readAs<SettingsAnswer>(priya.request, "/settings")).not.toHaveProperty("email");
        const denied = await priya.request.put("/api-proxy/settings/email", { data: original });
        expect(denied.status()).toBe(403);
        expect((await denied.json()).code).toBe("forbidden");

        // 5. Put back; two saves audited as Dana, on screen too.
        expect((await healEmail(dana.request, original!, secret)).status()).toBe(200);
        expect(await auditBy(dana.request, ACTION, "Dana Whitfield", since)).toBe(audited + 2);
        await expectAuditRows(dana.page, "Email and notifications", [ACTION], since);
      },
    );
  });
});
