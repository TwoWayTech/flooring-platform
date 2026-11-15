import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, MEETING_REFUSALS, newAttendee, type FeatureKey, type FeatureRegister } from "@workspace/shared";
import type { MeetingInput } from "@/lib/api/contract";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

/** Switches these tests turn off; every other one keeps its real value (S6). */
const OFF = vi.hoisted(() => new Set<string>());
vi.mock("@workspace/shared", async (importOriginal) => {
  const real = await importOriginal<typeof import("@workspace/shared")>();
  return {
    ...real,
    featureOn: (key: FeatureKey, register?: FeatureRegister) => (OFF.has(key) ? false : real.featureOn(key, register)),
  };
});

afterEach(() => OFF.clear());

const OWNER = "sm-usr-01";
const SALES = "sm-usr-03";
const HR = "sm-usr-07";
const SWITCHED_OFF = "This feature is switched off.";
/** Summit's seeded invite to Riley Chen, an email guest of the Owner's New build walkthrough. */
const SEEDED_INVITE = "sm-out-0001";

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

async function summit(): Promise<DemoStore> {
  const store = new DemoStore(noFiles);
  await store.openCompany("summit", { userId: OWNER, viewAsRoleId: null });
  return store;
}

function input(day: string, over: Partial<MeetingInput> = {}): MeetingInput {
  return {
    title: "Switch check",
    start: `${day}T10:00`,
    durationMin: 60,
    location: "Showroom",
    guests: [],
    newGuests: [],
    recurrence: "none",
    reminderMin: 15,
    notes: "",
    private: false,
    hideGuestList: false,
    allowProposals: true,
    ...over,
  };
}

async function refusal(action: Promise<unknown>): Promise<string> {
  try {
    await action;
    return "";
  } catch (failure) {
    return failure instanceof Error ? failure.message : String(failure);
  }
}

const priya = newAttendee({ kind: "staff", id: SALES, name: "", email: "" });
const accept = { partStat: "accepted" as const, note: "", proposal: null };

describe("the demo store's meetings switches (ADR 0051 part 3, CLAUDE.md rule 13)", () => {
  it("refuses guests, removals, answers, decisions and Simulate reply with invites off, and schedules without guests", async () => {
    const store = await summit();
    const day = addDays(store.today(), 20);
    const made = await store.createMeeting(input(day, { guests: [priya] }));
    store.setViewer({ userId: SALES, viewAsRoleId: null });
    await store.respondToMeeting(made.id, {
      partStat: "tentative",
      note: "",
      proposal: { start: `${day}T14:00`, durationMin: 60, note: "" },
    });
    store.setViewer({ userId: OWNER, viewAsRoleId: null });

    OFF.add("meetings.invites");
    expect(await refusal(store.createMeeting(input(day, { guests: [priya] })))).toBe(MEETING_REFUSALS.invitesOff);
    expect(
      await refusal(
        store.createMeeting(input(day, { newGuests: [{ email: "a@b.example", name: "", customerId: null }] })),
      ),
    ).toBe(MEETING_REFUSALS.invitesOff);
    const alone = await store.createMeeting(input(day, { start: `${day}T16:00` }));
    expect(alone.attendees.map((a) => a.id)).toEqual([OWNER]);
    expect((await store.listOutbox(true)).filter((row) => row.sourceId === alone.id)).toEqual([]);

    const data = await store.meetingsData();
    expect(data.guests).toEqual([]);
    expect(data.colleagues).toEqual([]);
    expect(await refusal(store.removeGuest(made.id, SALES))).toBe(SWITCHED_OFF);
    expect(await refusal(store.decideProposal(made.id, SALES, true))).toBe(SWITCHED_OFF);
    expect(await refusal(store.simulateReply(SEEDED_INVITE, accept))).toBe(SWITCHED_OFF);
    expect(
      await refusal(
        store.requestMeeting({
          withUserId: HR,
          title: "Ask",
          start: `${day}T09:00`,
          durationMin: 30,
          location: "",
          note: "",
          private: false,
        }),
      ),
    ).toBe(SWITCHED_OFF);
    store.setViewer({ userId: SALES, viewAsRoleId: null });
    expect(await refusal(store.respondToMeeting(made.id, accept))).toBe(SWITCHED_OFF);

    // Requests off alone: nobody to ask (S5), and a request is refused.
    OFF.clear();
    OFF.add("meetings.requests");
    store.setViewer({ userId: OWNER, viewAsRoleId: null });
    expect((await store.meetingsData()).colleagues).toEqual([]);
    expect((await store.meetingsData()).guests.length).toBeGreaterThan(0);
    expect(
      await refusal(
        store.requestMeeting({
          withUserId: HR,
          title: "Ask",
          start: `${day}T09:00`,
          durationMin: 30,
          location: "",
          note: "",
          private: false,
        }),
      ),
    ).toBe(SWITCHED_OFF);

    // Back on, Simulate reply answers for the seeded email guest.
    OFF.clear();
    const replied = await store.simulateReply(SEEDED_INVITE, accept);
    expect(replied.attendees.find((a) => a.id === "ext-sm-1")?.partStat).toBe("accepted");
  });

  it("refuses the meetings data and My meetings with the calendar off", async () => {
    const store = await summit();
    OFF.add("meetings.calendar");
    expect(await refusal(store.meetingsData())).toBe(SWITCHED_OFF);
    expect(await refusal(store.myMeetings())).toBe(SWITCHED_OFF);
    expect(await store.list("meetings")).toEqual([]);
    expect(await refusal(store.createMeeting(input(addDays(store.today(), 20))))).toBe(SWITCHED_OFF);
    expect(await refusal(store.meetingCalendarFile("sm-mtg-0001"))).toBe(SWITCHED_OFF);

    // My meetings is the portal's too: with hr.portal off it is refused, and nobody is offered to ask.
    OFF.clear();
    OFF.add("hr.portal");
    expect(await refusal(store.myMeetings())).toBe(SWITCHED_OFF);
    expect((await store.meetingsData()).colleagues).toEqual([]);
    OFF.clear();
    expect((await store.myMeetings()).meetings.length).toBeGreaterThan(0);
  });
});
