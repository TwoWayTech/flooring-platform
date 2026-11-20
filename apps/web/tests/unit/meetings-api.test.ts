import { afterEach, describe, expect, it, vi } from "vitest";
import type { Attendee, FeatureKey, FeatureRegister, GuestOption, Meeting, MyMeetings } from "@workspace/shared";
import type { ApiClient, MeetingInput, MeetingMove } from "@/lib/api/contract";
import { HttpApiError } from "@/lib/api/http/transport";
import { fakeApi, type FakeAnswer, type SentRequest } from "./fake-api";

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

const MEETING_ID = "0195f3a2-7b1c-7d4e-8f00-00000000aa01";
const VIEWER = "0195f3a2-7b1c-7d4e-8f00-00000000bb01";
const COLLEAGUE = "0195f3a2-7b1c-7d4e-8f00-00000000bb02";
const CUSTOMER = "0195f3a2-7b1c-7d4e-8f00-00000000cc01";

/** One guest row as a screen holds it, with everything the server ignores filled in. */
function guest(over: Partial<Attendee> = {}): Attendee {
  return {
    kind: "staff",
    id: COLLEAGUE,
    name: "A name the screen holds",
    email: "someone@summitfloor.example",
    role: "optional",
    partStat: "accepted",
    respondedAt: "2026-11-15T09:00",
    respondedSequence: 4,
    note: "a note",
    proposal: null,
    ...over,
  };
}

/** A meeting as GET /meetings answers it. */
function meeting(over: Partial<Meeting> = {}): Meeting {
  return {
    id: MEETING_ID,
    title: "Site visit",
    start: "2026-12-07T10:00",
    durationMin: 60,
    location: "Showroom",
    attendees: [guest({ id: VIEWER, partStat: "accepted" }), guest()],
    recurrence: "none",
    reminderMin: 15,
    ownerUserId: VIEWER,
    notes: "",
    timeZone: "America/Denver",
    until: null,
    exceptions: [],
    uid: "uid-1",
    sequence: 2,
    rescheduleSequence: 2,
    status: "confirmed",
    kind: "meeting",
    private: false,
    hideGuestList: false,
    allowProposals: false,
    ...over,
  };
}

const OPTIONS: GuestOption[] = [{ kind: "staff", id: COLLEAGUE, name: "Priya Natarajan", email: "" }];
const MINE: MyMeetings = {
  viewerUserId: VIEWER,
  meetings: [],
  colleagues: [{ id: COLLEAGUE, name: "Priya Natarajan" }],
};
const CONTEXT = { user: { id: VIEWER, name: "Luis Ortega", email: "luis@summitfloor.example" } };

const PAGE_ANSWERS: Record<string, FakeAnswer> = {
  "GET /meetings": { status: 200, body: [meeting()] },
  "GET /meeting-guests": { status: 200, body: OPTIONS },
  "GET /me/meetings": { status: 200, body: MINE },
  "GET /auth/context": { status: 200, body: CONTEXT },
};

describe("meetings on the API (ADR 0051 part 3)", () => {
  it("reads the Meetings page from /meetings, /meeting-guests and /me/meetings, with the viewer from /me/meetings and no /auth/context call", async () => {
    const { client, calls, changes } = fakeApi(PAGE_ANSWERS);
    expect(await client.meetingsData()).toEqual({
      viewerUserId: VIEWER,
      meetings: [meeting()],
      guests: OPTIONS,
      colleagues: MINE.colleagues,
      newGuestHandling: "none",
    });
    expect(calls()).toEqual(["GET /me/meetings", "GET /meeting-guests", "GET /meetings"]);
    expect(changes()).toBe(0);
  });

  it("asks /auth/context for the viewer only when /me/meetings gave no answer (403 or 404) or requests are off", async () => {
    for (const status of [403, 404]) {
      const { client, calls } = fakeApi({ ...PAGE_ANSWERS, "GET /me/meetings": { status } });
      const data = await client.meetingsData();
      expect(data.viewerUserId).toBe(VIEWER);
      expect(data.colleagues).toEqual([]);
      expect(calls()).toContain("GET /auth/context");
    }
    for (const off of ["meetings.requests", "meetings.invites"]) {
      OFF.add(off);
      const { client, calls } = fakeApi(PAGE_ANSWERS);
      const data = await client.meetingsData();
      expect(data).toMatchObject({ viewerUserId: VIEWER, colleagues: [] });
      expect(calls()).toEqual(["GET /auth/context", "GET /meeting-guests", "GET /meetings"]);
      OFF.clear();
    }
    // A server failure there is not "no answer": the page shows the error rather than guess.
    const { client } = fakeApi({ ...PAGE_ANSWERS, "GET /me/meetings": { status: 500 } });
    await expect(client.meetingsData()).rejects.toBeInstanceOf(HttpApiError);
  });

  it("reads no guests with invites off (404) or without create (403), and never saves new guests", async () => {
    for (const status of [403, 404]) {
      const { client } = fakeApi({ ...PAGE_ANSWERS, "GET /meeting-guests": { status } });
      const data = await client.meetingsData();
      expect(data.guests).toEqual([]);
      expect(data.newGuestHandling).toBe("none");
    }
  });

  it("reads My meetings from /me/meetings, and a 403 or 404 there as nothing to show", async () => {
    const { client, calls } = fakeApi(PAGE_ANSWERS);
    expect(await client.myMeetings()).toEqual(MINE);
    expect(calls()).toEqual(["GET /me/meetings"]);
    for (const status of [403, 404]) {
      const refused = fakeApi({ "GET /me/meetings": { status } });
      expect(await refused.client.myMeetings()).toEqual({ viewerUserId: "", meetings: [], colleagues: [] });
    }
    await expect(fakeApi({ "GET /me/meetings": { status: 500 } }).client.myMeetings()).rejects.toBeInstanceOf(
      HttpApiError,
    );
  });

  it("sends a new meeting with only who each guest is: kind and id, and a new guest's address and name", async () => {
    const { client, sent } = fakeApi({ "POST /meetings": { status: 201, body: meeting() } });
    const input: MeetingInput = {
      title: "Site visit",
      start: "2026-12-07T10:00",
      durationMin: 60,
      location: "Showroom",
      guests: [guest(), guest({ kind: "customer", id: CUSTOMER, name: "Not from the records" })],
      newGuests: [{ email: "riley@builders.example", name: "Riley", customerId: CUSTOMER }],
      recurrence: "weekly",
      reminderMin: 30,
      notes: "Bring samples",
      private: false,
      hideGuestList: true,
      allowProposals: true,
    };
    await client.createMeeting(input);
    expect(sent).toEqual([
      {
        call: "POST /meetings",
        body: {
          title: "Site visit",
          start: "2026-12-07T10:00",
          durationMin: 60,
          location: "Showroom",
          notes: "Bring samples",
          recurrence: "weekly",
          reminderMin: 30,
          private: false,
          hideGuestList: true,
          guests: [
            { kind: "staff", id: COLLEAGUE },
            { kind: "customer", id: CUSTOMER },
          ],
          newGuests: [{ email: "riley@builders.example", name: "Riley" }],
        },
      },
    ]);
  });

  it("sends Undo as the SEQUENCE the screen saw, to the meeting it moved, and nothing else", async () => {
    const { client, sent } = fakeApi();
    await client.undoReschedule({
      previous: meeting({ sequence: 3, title: "A copy the server must not read", start: "2020-01-01T00:00" }),
      createdIds: ["0195f3a2-7b1c-7d4e-8f00-00000000aa02"],
    });
    expect(sent).toEqual([{ call: `POST /meetings/${MEETING_ID}/reschedule/undo`, body: { sequence: 3 } }]);
  });

  it("moves at /meetings/:id/reschedule with the move as the screen made it", async () => {
    const { client, sent } = fakeApi({
      [`POST /meetings/${MEETING_ID}/reschedule`]: {
        status: 201,
        body: { meetings: [], conflicts: [], undo: { previous: meeting(), createdIds: [] } },
      },
    });
    const move: MeetingMove = {
      meetingId: MEETING_ID,
      planned: "2026-12-07T10:00",
      start: "2026-12-07T15:00",
      durationMin: 45,
      scope: "this",
    };
    await client.rescheduleMeeting(move);
    expect(sent).toEqual([{ call: `POST /meetings/${MEETING_ID}/reschedule`, body: move }]);
  });

  it("answers, decides, removes, cancels, edits, requests and downloads at the contract's paths and bodies", async () => {
    const proposal = { start: "2026-12-08T09:00", durationMin: 30, note: "Earlier?" };
    const cases: [string, (client: ApiClient) => Promise<unknown>, SentRequest][] = [
      [
        "answer",
        (c) => c.respondToMeeting(MEETING_ID, { partStat: "tentative", note: "Maybe", proposal }),
        {
          call: `POST /meetings/${MEETING_ID}/response`,
          body: { partStat: "tentative", note: "Maybe", proposal },
        },
      ],
      [
        "answer without a proposal",
        (c) => c.respondToMeeting(MEETING_ID, { partStat: "accepted", note: "", proposal: null }),
        { call: `POST /meetings/${MEETING_ID}/response`, body: { partStat: "accepted", note: "", proposal: null } },
      ],
      [
        "decide",
        (c) => c.decideProposal(MEETING_ID, COLLEAGUE, false),
        { call: `POST /meetings/${MEETING_ID}/attendees/${COLLEAGUE}/proposal`, body: { accept: false } },
      ],
      [
        "remove",
        (c) => c.removeGuest(MEETING_ID, COLLEAGUE),
        { call: `DELETE /meetings/${MEETING_ID}/attendees/${COLLEAGUE}`, body: undefined },
      ],
      ["cancel", (c) => c.cancelMeeting(MEETING_ID), { call: `POST /meetings/${MEETING_ID}/cancel`, body: undefined }],
      [
        "edit",
        (c) => c.updateMeeting(MEETING_ID, { title: "Site visit 2", notes: undefined, reminderMin: 60 }),
        { call: `PATCH /meetings/${MEETING_ID}`, body: { title: "Site visit 2", reminderMin: 60 } },
      ],
      [
        "request",
        (c) =>
          c.requestMeeting({
            withUserId: COLLEAGUE,
            title: "Catch up",
            start: "2026-12-09T10:00",
            durationMin: 90,
            location: "Somewhere the server ignores",
            note: "About the quote",
            private: true,
          }),
        {
          call: "POST /meeting-requests",
          body: {
            withUserId: COLLEAGUE,
            title: "Catch up",
            start: "2026-12-09T10:00",
            note: "About the quote",
            private: true,
          },
        },
      ],
      [
        "download",
        (c) => c.meetingCalendarFile(MEETING_ID),
        { call: `GET /meetings/${MEETING_ID}/calendar.ics`, body: undefined },
      ],
    ];
    for (const [name, call, expected] of cases) {
      const { client, sent, changes } = fakeApi();
      await call(client);
      expect(sent, name).toEqual([expected]);
      // Every write makes the screens read again; the download is a read.
      expect(changes(), name).toBe(name === "download" ? 0 : 1);
    }
  });

  it("tells the screens to re-read after a write succeeds or the server refuses it (400, 403, 404, 409), and not after a network failure or a 500", async () => {
    const cancel = `POST /meetings/${MEETING_ID}/cancel`;
    for (const status of [200, 400, 403, 404, 409]) {
      const { client, changes } = fakeApi({ [cancel]: { status, body: { code: "x", message: "Refused." } } });
      await client.cancelMeeting(MEETING_ID).catch(() => undefined);
      expect(changes(), `status ${status}`).toBe(1);
    }
    for (const answer of ["network", { status: 401 }, { status: 429 }, { status: 500 }] as FakeAnswer[]) {
      const { client, changes } = fakeApi({ [cancel]: answer });
      await expect(client.cancelMeeting(MEETING_ID)).rejects.toBeInstanceOf(HttpApiError);
      expect(changes(), JSON.stringify(answer)).toBe(0);
    }
    // A refusal still reaches the screen, in the server's words, after the re-read was asked for.
    const refused = fakeApi({ [cancel]: { status: 400, body: { code: "invalid_request", message: "Already." } } });
    await expect(refused.client.cancelMeeting(MEETING_ID)).rejects.toMatchObject({ status: 400, message: "Already." });
    // Reads never ask for a re-read, or a screen would read forever.
    const reads = fakeApi(PAGE_ANSWERS);
    await reads.client.meetingsData();
    await reads.client.myMeetings();
    await reads.client.meetingCalendarFile(MEETING_ID);
    expect(reads.changes()).toBe(0);
  });
});
