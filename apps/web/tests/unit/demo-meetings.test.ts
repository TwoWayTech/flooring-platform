import { afterEach, describe, expect, it, vi } from "vitest";
import { format } from "date-fns";
import {
  addDays,
  changeableAsShown,
  MEETING_CHANGED,
  MEETING_REFUSALS,
  newAttendee,
  zonedToInstant,
  type Attendee,
  type Meeting,
  type MeetingViewer,
  type OutboxMessage,
} from "@workspace/shared";
import { viewerAccess } from "@/lib/access";
import type { MeetingInput } from "@/lib/api/contract";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

/** Summit personas (fixtures): Owner, branch Manager, own-scope Sales, HR and an Employee. */
const OWNER = "sm-usr-01";
const MANAGER = "sm-usr-02";
const SALES = "sm-usr-03";
const HR = "sm-usr-07";
const EMPLOYEE = "sm-usr-14";
/** A Denver customer of the Sales rep, so Summit's Manager reads them. */
const DENVER_CUSTOMER = "sm-cus-0003";

/** No proof files in these tests. */
const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

/** A fresh demo store with Summit open for one person (each test starts from the fixtures). */
async function summit(userId = OWNER): Promise<DemoStore> {
  const store = new DemoStore(noFiles);
  await store.openCompany("summit", { userId, viewAsRoleId: null });
  return store;
}

/** The person looking from now on, in the same store. */
const as = (store: DemoStore, userId: string, viewAsRoleId: string | null = null) =>
  store.setViewer({ userId, viewAsRoleId });

/** The first day on or after `minDays` from today that falls on `dow` (0 Sunday), "YYYY-MM-DD". */
function nextWeekday(today: string, dow: number, minDays: number): string {
  let day = addDays(today, minDays);
  while (new Date(`${day}T00:00:00Z`).getUTCDay() !== dow) day = addDays(day, 1);
  return day;
}

const staff = (id: string): Attendee => newAttendee({ kind: "staff", id, name: "", email: "" });

/** A New meeting form as a screen sends it, at 10:00 on `day`. */
function input(day: string, over: Partial<MeetingInput> = {}): MeetingInput {
  return {
    title: "Test meeting",
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

/** The refusal an action gives, or "" when it was allowed. */
async function refusal(action: Promise<unknown>): Promise<string> {
  try {
    await action;
    return "";
  } catch (failure) {
    return failure instanceof Error ? failure.message : String(failure);
  }
}

/** The meeting as the store gives it to the person looking now, or undefined when they can't see it. */
async function seen(store: DemoStore, id: string): Promise<Meeting | undefined> {
  return (await store.meetingsData()).meetings.find((m) => m.id === id);
}

/** Every Outbox row of a meeting, as the Owner reads the whole Outbox. */
async function outboxOf(store: DemoStore, meetingId: string): Promise<OutboxMessage[]> {
  return (await store.listOutbox(true)).filter((row) => row.sourceId === meetingId);
}

/** The person's meeting rules view, from the store's own roles (the screens build it the same way). */
async function viewerOf(store: DemoStore, userId: string): Promise<MeetingViewer> {
  const [company, roles, users] = await Promise.all([store.getCompany(), store.list("roles"), store.list("users")]);
  const access = viewerAccess(
    company,
    roles,
    users.find((u) => u.id === userId)!,
    null,
  );
  return { userId, permissions: access.permissions, dataScope: access.dataScope };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the demo store's meetings on the shared rules (ADR 0051 part 3)", () => {
  it("opens Summit in Node", async () => {
    const store = await summit();
    expect((await store.meetingsData()).meetings.length).toBeGreaterThan(0);
  });

  it("schedules with the organiser once, guests from the store's own records and the server's flags", async () => {
    const store = await summit();
    const day = nextWeekday(store.today(), 2, 20);
    const made = await store.createMeeting(
      input(day, {
        guests: [
          { ...staff(OWNER), name: "Not me" },
          { ...staff(SALES), name: "A name the screen made up", email: "made.up@example.com", partStat: "accepted" },
          newAttendee({ kind: "customer", id: DENVER_CUSTOMER, name: "Fake name", email: "fake@example.com" }),
        ],
      }),
    );
    const users = await store.list("users");
    const customer = (await store.list("customers")).find((c) => c.id === DENVER_CUSTOMER)!;
    const priya = users.find((u) => u.id === SALES)!;
    expect(made.attendees.map((a) => [a.kind, a.id, a.name, a.email, a.partStat])).toEqual([
      ["staff", OWNER, "Dana Whitfield", users.find((u) => u.id === OWNER)!.email, "accepted"],
      ["staff", SALES, priya.name, priya.email, "needs-action"],
      ["customer", DENVER_CUSTOMER, customer.name, customer.email, "needs-action"],
    ]);
    // A customer is outside the company, so the list is hidden; the Owner may decide proposals.
    expect(made).toMatchObject({ hideGuestList: true, allowProposals: true, timeZone: "America/Denver", sequence: 0 });
    const invites = (await outboxOf(store, made.id)).filter((r) => r.eventKey === "meeting.invite");
    expect(invites.map((r) => r.recipient.id).sort()).toEqual([DENVER_CUSTOMER, SALES].sort());
    expect(invites.every((r) => r.attachments[0]?.text?.includes("PRODID:-//Flooring Suite//Demo//EN"))).toBe(true);

    // An Employee holds no edit key, so their meeting takes no proposals; colleagues only keep the list open.
    as(store, EMPLOYEE);
    const theirs = await store.createMeeting(input(day, { start: `${day}T13:00`, guests: [staff(HR)] }));
    expect(theirs).toMatchObject({ allowProposals: false, hideGuestList: false, ownerUserId: EMPLOYEE });
    expect(theirs.attendees.map((a) => a.id)).toEqual([EMPLOYEE, HR]);
  });

  it("refuses what the API refuses: the start bound, a length past a day, a fifth-week monthly start", async () => {
    const store = await summit();
    const today = store.today();
    expect(await refusal(store.createMeeting(input(addDays(today, 1200))))).toBe(
      "Choose a start from one year ago up to three years ahead.",
    );
    expect(await refusal(store.createMeeting(input(addDays(today, 10), { durationMin: 1500 })))).toBe(
      "A meeting lasts from 15 minutes to 24 hours, in whole minutes.",
    );
    const fifthWeek = `${addDays(today, 40).slice(0, 8)}29`;
    expect(await refusal(store.createMeeting(input(fifthWeek, { recurrence: "monthly" })))).toBe(
      "A monthly meeting can't start in the fifth week of a month.",
    );
    expect(await refusal(store.createMeeting(input(addDays(today, 10), { title: "  " })))).toBe(
      "Give the meeting a title.",
    );
  });

  it("lists each meeting as the reader may read it: a private one only to its people, no other addresses for a guest", async () => {
    const store = await summit(HR);
    const day = nextWeekday(store.today(), 3, 20);
    const review = await store.createMeeting(
      input(day, { title: "Private review", private: true, guests: [staff(EMPLOYEE)] }),
    );

    as(store, OWNER);
    expect(await seen(store, review.id)).toBeUndefined();

    as(store, EMPLOYEE);
    const asGuest = (await seen(store, review.id))!;
    // A private meeting hides its list, so the guest reads only their own row, with their own address.
    expect(asGuest.attendees.map((a) => [a.id, a.email !== ""])).toEqual([[EMPLOYEE, true]]);

    // Crew scheduling is Cole's, with the Sales rep as a guest: she reads no other address.
    as(store, SALES);
    const crew = (await seen(store, "sm-mtg-0008"))!;
    expect(crew.attendees.map((a) => [a.id, a.email !== ""])).toEqual([
      ["sm-usr-04", false],
      [SALES, true],
    ]);
    // Own scope sees only the meetings the person is on.
    const ids = (await store.meetingsData()).meetings.map((m) => m.id);
    expect(ids).toContain("sm-mtg-0008");
    expect(ids).not.toContain("sm-mtg-0003");
  });

  it("lets only someone who may change a meeting edit, cancel or remove a guest, in the API's words", async () => {
    const store = await summit();
    const day = nextWeekday(store.today(), 3, 20);
    const made = await store.createMeeting(input(day, { title: "Controls check", guests: [staff(SALES)] }));

    as(store, SALES);
    expect(await refusal(store.updateMeeting(made.id, { title: "Mine now" }))).toBe(MEETING_REFUSALS.notOrganiser);
    expect(await refusal(store.cancelMeeting(made.id))).toBe(MEETING_REFUSALS.notOrganiser);
    expect(await refusal(store.removeGuest(made.id, SALES))).toBe(MEETING_REFUSALS.notOrganiser);

    // The branch Manager may change a meeting that is not private (scope wider than own).
    as(store, MANAGER);
    expect((await store.updateMeeting(made.id, { title: "Controls check, renamed" })).title).toBe(
      "Controls check, renamed",
    );

    as(store, OWNER);
    expect(await refusal(store.removeGuest(made.id, OWNER))).toBe("The organiser can't be removed from the meeting.");
    expect(await refusal(store.removeGuest(made.id, "sm-usr-99"))).toBe("This guest no longer exists.");
    await store.cancelMeeting(made.id);
    expect(await refusal(store.cancelMeeting(made.id))).toBe("This meeting was already cancelled.");
    expect(await refusal(store.updateMeeting(made.id, { title: "Again" }))).toBe("This meeting was cancelled.");

    // A meeting the reader can't see is gone, whether or not it exists.
    const hidden = await store.createMeeting(input(day, { start: `${day}T14:00`, private: true }));
    as(store, MANAGER);
    expect(await refusal(store.updateMeeting(hidden.id, { title: "Peek" }))).toBe("This meeting no longer exists.");
  });

  it("gives a branch Manager no change on a hidden-list meeting whose customer they can't read, and the change once they can", async () => {
    const store = await summit();
    const day = nextWeekday(store.today(), 4, 20);
    // A customer of a Colorado Springs rep: outside the Denver Manager's branch.
    const base = (await store.list("customers")).find((c) => c.id === DENVER_CUSTOMER)!;
    await store.save("customers", { ...base, id: "sm-cus-springs", name: "Springs Customer", salesRepId: "sm-usr-04" });
    const outside = await store.createMeeting(
      input(day, {
        title: "Outside branch",
        guests: [newAttendee({ kind: "customer", id: "sm-cus-springs", name: "", email: "" })],
      }),
    );
    const inside = await store.createMeeting(
      input(day, {
        title: "Inside branch",
        start: `${day}T14:00`,
        guests: [newAttendee({ kind: "customer", id: DENVER_CUSTOMER, name: "", email: "" })],
      }),
    );

    as(store, MANAGER);
    const viewer = await viewerOf(store, MANAGER);
    for (const [meeting, canChange] of [
      [outside, false],
      [inside, true],
    ] as const) {
      const shown = (await seen(store, meeting.id))!;
      const answer = await refusal(store.updateMeeting(meeting.id, { notes: "Checked" }));
      expect(answer, meeting.title).toBe(canChange ? "" : MEETING_REFUSALS.cantSeeEveryGuest);
      expect(changeableAsShown(viewer, shown), meeting.title).toBe(canChange);
    }
    // The hidden list without the right to change shows the Manager nobody, not even the organiser.
    expect((await seen(store, outside.id))!.attendees).toEqual([]);
  });

  it("refuses This and following from the first occurrence and All events from an occurrence moved on its own", async () => {
    const store = await summit();
    const day = nextWeekday(store.today(), 1, 8);
    const series = await store.createMeeting(
      input(day, { title: "First occurrence check", start: `${day}T07:00`, recurrence: "weekly" }),
    );
    const first = series.start;
    expect(
      await refusal(
        store.rescheduleMeeting({
          meetingId: series.id,
          planned: first,
          start: `${day}T08:00`,
          durationMin: 60,
          scope: "following",
        }),
      ),
    ).toBe("This is the first occurrence of the series. Choose All events to move the whole series.");

    const second = `${addDays(day, 7)}T07:00`;
    await store.rescheduleMeeting({
      meetingId: series.id,
      planned: second,
      start: `${addDays(day, 7)}T08:00`,
      durationMin: 60,
      scope: "this",
    });
    expect(
      await refusal(
        store.rescheduleMeeting({
          meetingId: series.id,
          planned: second,
          start: `${addDays(day, 7)}T09:00`,
          durationMin: 60,
          scope: "all",
        }),
      ),
    ).toBe("This occurrence was changed on its own. Choose This event, or move another occurrence to move all events.");
  });

  it("warns about no meeting itself after moving all events, and calls a meeting the mover can't read Busy", async () => {
    const store = await summit();
    const day = nextWeekday(store.today(), 2, 30);
    const series = await store.createMeeting(
      input(day, { title: "Series check", start: `${day}T07:00`, recurrence: "weekly", guests: [staff(EMPLOYEE)] }),
    );
    const moved = await store.rescheduleMeeting({
      meetingId: series.id,
      planned: series.start,
      start: `${day}T07:30`,
      durationMin: 60,
      scope: "all",
    });
    expect(moved.conflicts).toEqual([]);

    as(store, HR);
    await store.createMeeting(
      input(day, { title: "Private review", start: `${day}T15:00`, private: true, guests: [staff(EMPLOYEE)] }),
    );
    as(store, OWNER);
    const busy = await store.createMeeting(input(day, { title: "Busy check", guests: [staff(EMPLOYEE)] }));
    const answer = await store.rescheduleMeeting({
      meetingId: busy.id,
      planned: busy.start,
      start: `${day}T15:00`,
      durationMin: 60,
      scope: "all",
    });
    expect(answer.conflicts).toEqual([{ name: "Bri Alvarez", title: "Busy", start: `${day}T15:00` }]);
    expect(JSON.stringify(answer)).not.toContain("Private review");
  });

  it("undoes only the mover's last move, within five minutes, at the SEQUENCE they saw, and removes a split with a CANCEL to its guests", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const store = await summit();
    const day = nextWeekday(store.today(), 1, 8);
    const series = await store.createMeeting(
      input(day, { title: "Undo check", start: `${day}T07:00`, recurrence: "weekly", guests: [staff(SALES)] }),
    );
    const second = `${addDays(day, 7)}T07:00`;
    const moveThis = () =>
      store.rescheduleMeeting({
        meetingId: series.id,
        planned: second,
        start: `${addDays(day, 7)}T08:00`,
        durationMin: 60,
        scope: "this",
      });

    // Only the mover, and only at the SEQUENCE their screen saw (checked first, ADR 0051 part 3).
    const { undo } = await moveThis();
    as(store, MANAGER);
    expect(await refusal(store.undoReschedule(undo))).toBe("Only the person who moved this meeting can undo the move.");
    expect(
      await refusal(
        store.undoReschedule({ ...undo, previous: { ...undo.previous, sequence: undo.previous.sequence + 1 } }),
      ),
    ).toBe(MEETING_CHANGED.message);
    as(store, OWNER);
    const restored = await store.undoReschedule(undo);
    expect(restored.exceptions).toEqual([]);
    expect(restored.sequence).toBe(undo.previous.sequence + 2);
    expect(await refusal(store.undoReschedule(undo))).toBe(MEETING_CHANGED.message);

    // Five minutes by the clock.
    const late = await moveThis();
    vi.setSystemTime(Date.now() + 6 * 60_000);
    expect(await refusal(store.undoReschedule(late.undo))).toBe("This move can no longer be undone.");

    // Any change after the move, an answer included, makes it no longer undoable.
    const answered = await store.rescheduleMeeting({
      meetingId: series.id,
      planned: `${addDays(day, 14)}T07:00`,
      start: `${addDays(day, 14)}T09:00`,
      durationMin: 60,
      scope: "this",
    });
    as(store, SALES);
    await store.respondToMeeting(series.id, { partStat: "accepted", note: "", proposal: null });
    as(store, OWNER);
    expect(await refusal(store.undoReschedule(answered.undo))).toBe(MEETING_CHANGED.message);

    // A split is removed, and its guests are told it is cancelled.
    const split = await store.rescheduleMeeting({
      meetingId: series.id,
      planned: `${addDays(day, 21)}T07:00`,
      start: `${addDays(day, 21)}T10:00`,
      durationMin: 60,
      scope: "following",
    });
    const [splitId] = split.undo.createdIds;
    expect(splitId).toBeDefined();
    expect(split.meetings.find((m) => m.id === splitId)!.attendees.map((a) => a.id)).toEqual([OWNER, SALES]);
    await store.undoReschedule(split.undo);
    expect(await seen(store, splitId!)).toBeUndefined();
    const cancels = (await outboxOf(store, splitId!)).filter((r) => r.values["meeting.action"] === "Cancelled");
    expect(cancels.map((r) => r.recipient.id)).toEqual([SALES]);
    expect(cancels[0]!.attachments[0]!.text).toContain("METHOD:CANCEL");
  });

  it("moves a one-off twice from its fresh occurrence", async () => {
    const store = await summit();
    const day = nextWeekday(store.today(), 4, 20);
    const made = await store.createMeeting(input(day, { title: "Twice moved" }));
    const once = await store.rescheduleMeeting({
      meetingId: made.id,
      planned: made.start,
      start: `${day}T11:00`,
      durationMin: 60,
      scope: "all",
    });
    const fresh = once.meetings[0]!;
    expect(fresh.start).toBe(`${day}T11:00`);
    const twice = await store.rescheduleMeeting({
      meetingId: made.id,
      planned: fresh.start,
      start: `${day}T12:00`,
      durationMin: 60,
      scope: "all",
    });
    expect(twice.meetings[0]!.start).toBe(`${day}T12:00`);
    // The occurrence the screen held before the first move no longer exists.
    expect(
      await refusal(
        store.rescheduleMeeting({
          meetingId: made.id,
          planned: made.start,
          start: `${day}T13:00`,
          durationMin: 60,
          scope: "all",
        }),
      ),
    ).toBe("That occurrence is not part of this meeting. Reload the calendar and try again.");
  });

  it("lets only the organiser who may change the meeting decide, and sends the proposer a DECLINECOUNTER", async () => {
    const store = await summit();
    const day = nextWeekday(store.today(), 3, 20);
    const made = await store.createMeeting(input(day, { title: "Proposal check", guests: [staff(SALES)] }));
    const propose = async () => {
      as(store, SALES);
      await store.respondToMeeting(made.id, {
        partStat: "tentative",
        note: "Later?",
        proposal: { start: `${day}T14:00`, durationMin: 60, note: "Later?" },
      });
    };
    await propose();

    // The Manager may change the meeting but is not its organiser, and is never shown the proposal.
    as(store, MANAGER);
    expect((await seen(store, made.id))!.attendees.every((a) => a.proposal === null)).toBe(true);
    expect(await refusal(store.decideProposal(made.id, SALES, true))).toBe(MEETING_REFUSALS.organiserDecides);

    as(store, OWNER);
    await store.decideProposal(made.id, SALES, false);
    const declined = (await outboxOf(store, made.id)).filter((r) => r.values["meeting.action"] === "Proposal declined");
    expect(declined.map((r) => r.recipient.id)).toEqual([SALES]);
    expect(declined[0]!.attachments[0]!.text).toContain("METHOD:DECLINECOUNTER");
    expect(await refusal(store.decideProposal(made.id, SALES, false))).toBe(
      "There is no proposal waiting from this guest.",
    );

    await propose();
    as(store, OWNER);
    const accepted = await store.decideProposal(made.id, SALES, true);
    expect(accepted).toMatchObject({ start: `${day}T14:00`, sequence: made.sequence + 1 });
    expect(accepted.attendees.find((a) => a.id === SALES)).toMatchObject({ partStat: "needs-action" });
  });

  it("takes answers only from a staff guest who is not the organiser, never on a cancelled meeting", async () => {
    const store = await summit();
    const day = nextWeekday(store.today(), 3, 20);
    const made = await store.createMeeting(input(day, { title: "Answer check", guests: [staff(SALES)] }));
    const accept = { partStat: "accepted" as const, note: "", proposal: null };
    expect(await refusal(store.respondToMeeting(made.id, accept))).toBe(MEETING_REFUSALS.notAGuest);
    as(store, MANAGER);
    expect(await refusal(store.respondToMeeting(made.id, accept))).toBe(MEETING_REFUSALS.notAGuest);

    as(store, SALES);
    expect((await store.respondToMeeting(made.id, accept)).attendees.find((a) => a.id === SALES)?.partStat).toBe(
      "accepted",
    );
    expect(await refusal(store.respondToMeeting(made.id, { ...accept, partStat: "needs-action" }))).toBe(
      "Answer Accept, Maybe or Decline.",
    );
    as(store, OWNER);
    const replies = (await outboxOf(store, made.id)).filter((r) => r.eventKey === "meeting.reply");
    expect(replies.map((r) => r.recipient.id)).toEqual([OWNER]);
    await store.cancelMeeting(made.id);
    as(store, SALES);
    expect(await refusal(store.respondToMeeting(made.id, accept))).toBe("This meeting was cancelled.");
  });

  it("offers only active colleagues who can read meetings, and only to a reader with the portal, with requests and invites on", async () => {
    const store = await summit();
    const ids = (await store.meetingsData()).colleagues.map((c) => c.id);
    expect(ids).toContain(EMPLOYEE);
    // Not the reader, not an invited or disabled user.
    for (const absent of [OWNER, "sm-usr-12", "sm-usr-13"]) expect(ids).not.toContain(absent);

    // Installers who can no longer read meetings are not offered.
    const roles = await store.list("roles");
    const installer = roles.find((r) => r.key === "installer")!;
    await store.saveRole({
      ...installer,
      permissions: installer.permissions.filter((p) => p !== "meetings.meeting.view"),
    });
    const after = (await store.meetingsData()).colleagues.map((c) => c.id);
    expect(after).not.toContain("sm-usr-05");
    expect(after).not.toContain("sm-usr-11");

    // A role without the portal key gets nobody to ask, so Request is hidden and refused.
    const noPortal = {
      ...installer,
      id: "sm-role-meetings-only",
      key: "meetings-only",
      name: "Meetings only",
      system: false,
    };
    await store.saveRole({
      ...noPortal,
      permissions: ["meetings.meeting.view", "meetings.meeting.create"],
      dataScope: "own",
    });
    as(store, OWNER, noPortal.id);
    expect((await store.meetingsData()).colleagues).toEqual([]);
    const day = nextWeekday(store.today(), 3, 20);
    expect(
      await refusal(
        store.requestMeeting({
          withUserId: HR,
          title: "Catch up",
          start: `${day}T10:00`,
          durationMin: 30,
          location: "",
          note: "",
          private: false,
        }),
      ),
    ).toBe(MEETING_REFUSALS.chooseColleague);

    // With the portal, a request to someone offered goes through, at the server's length and place.
    as(store, EMPLOYEE);
    const request = await store.requestMeeting({
      withUserId: HR,
      title: "Catch up",
      start: `${day}T10:00`,
      durationMin: 90,
      location: "Anywhere",
      note: "",
      private: false,
    });
    expect(request).toMatchObject({ kind: "request", status: "tentative", durationMin: 30, location: "To be agreed" });
    // The Employee may not decide proposals, so the request takes none (ADR 0051 decision 8).
    expect(request.allowProposals).toBe(false);
  });

  it("uses the signed-in person with the viewed role's scope for list, sight and actions under View as", async () => {
    const store = await summit();
    const sales = (await store.list("roles")).find((r) => r.key === "sales")!;
    as(store, OWNER, sales.id);
    const data = await store.meetingsData();
    expect(data.viewerUserId).toBe(OWNER);
    const ids = data.meetings.map((m) => m.id);
    // The Owner's own meetings, never the borrowed Sales rep's.
    expect(ids).toContain("sm-mtg-0001");
    expect(ids).not.toContain("sm-mtg-0008");
    // Own scope over customers is the Owner's own customers: Summit's are all the reps'.
    expect(data.guests.some((g) => g.kind === "customer")).toBe(false);
    const day = nextWeekday(store.today(), 3, 20);
    expect(
      await refusal(
        store.createMeeting(
          input(day, { guests: [newAttendee({ kind: "customer", id: DENVER_CUSTOMER, name: "", email: "" })] }),
        ),
      ),
    ).toBe("This guest no longer exists.");
  });

  it("gives My meetings each meeting's next occurrence, soonest first", async () => {
    const store = await summit();
    const today = store.today();
    const weekly = await store.createMeeting(
      input(addDays(today, -14), {
        title: "Weekly with Bri",
        start: `${addDays(today, -14)}T07:00`,
        recurrence: "weekly",
        guests: [staff(EMPLOYEE)],
      }),
    );
    as(store, EMPLOYEE);
    const mine = await store.myMeetings();
    expect(mine.viewerUserId).toBe(EMPLOYEE);
    const starts = mine.meetings.map((m) => m.next.start);
    expect(starts).toEqual([...starts].sort());
    expect(starts.every((start) => start.slice(0, 10) >= today)).toBe(true);
    const next = mine.meetings.find((m) => m.meeting.id === weekly.id)!;
    expect(next.next.start).toBe(`${today}T07:00`);
    expect(mine.meetings.map((m) => m.meeting.title)).toContain("Install walkthrough: Mazie Kutch");
    expect(mine.colleagues.length).toBeGreaterThan(0);
  });

  it("re-syncs the reminder after a change and drops it on cancel", async () => {
    const store = await summit();
    const day = nextWeekday(store.today(), 3, 20);
    const made = await store.createMeeting(input(day, { title: "Reminder check", guests: [staff(SALES)] }));
    // Stored as the browser-local stamp the demo's `releaseScheduled` compares with its clock.
    const due = (local: string) =>
      format(new Date(zonedToInstant(local, "America/Denver").instant!.getTime() - 15 * 60_000), "yyyy-MM-dd'T'HH:mm");
    const reminders = async () => (await outboxOf(store, made.id)).filter((r) => r.eventKey === "meeting.reminder");

    expect((await reminders()).map((r) => [r.status, r.recipient.id, r.scheduledFor])).toEqual([
      ["scheduled", SALES, due(`${day}T10:00`)],
    ]);
    await store.updateMeeting(made.id, { start: `${day}T11:00` });
    expect((await reminders()).map((r) => [r.status, r.scheduledFor])).toEqual([
      ["cancelled", due(`${day}T10:00`)],
      ["scheduled", due(`${day}T11:00`)],
    ]);
    await store.cancelMeeting(made.id);
    expect((await reminders()).every((r) => r.status === "cancelled")).toBe(true);
  });
});
