/** A proposed new time from a guest (ADR 0021). */
export interface MeetingProposal {
  start: string;
  durationMin: number;
  note: string;
  status: "pending" | "accepted" | "declined";
}

/** A meeting guest: staff, a company, a person at a company, or someone added by email. */
export interface Attendee {
  kind: "staff" | "customer" | "supplier" | "customer-contact" | "supplier-contact" | "external";
  id: string;
  name: string;
  email: string;
  role: "required" | "optional";
  partStat: "needs-action" | "accepted" | "tentative" | "declined";
  respondedAt: string | null;
  respondedSequence: number | null;
  note: string;
  proposal: MeetingProposal | null;
}

/** A meeting, possibly recurring. */
export interface Meeting {
  id: string;
  title: string;
  start: string;
  durationMin: number;
  location: string;
  attendees: Attendee[];
  recurrence: "none" | "weekly" | "biweekly" | "monthly";
  reminderMin: number;
  ownerUserId: string;
  notes: string;
  /** The time zone the meeting is booked in; times and reminders follow it (spec F). */
  timeZone: string;
  /** The last day a recurring series runs, or null for no end (set when it is split, spec F). */
  until: string | null;
  /** Occurrences moved, resized or cancelled on their own, by the date-time the series planned them for. */
  exceptions: MeetingException[];
  /** Set once at creation and never changed, so calendars recognise updates (ADR 0021). */
  uid: string;
  sequence: number;
  /** The SEQUENCE at the last significant change; a reply below it is stale (ADR 0021). */
  rescheduleSequence: number;
  status: "tentative" | "confirmed" | "cancelled";
  kind: "meeting" | "request";
  /** Only its people can see it (spec E: HR meetings can be private). */
  private: boolean;
  hideGuestList: boolean;
  allowProposals: boolean;
}

/** One occurrence of a series changed on its own (spec F "this event"). */
export interface MeetingException {
  planned: string;
  start?: string;
  durationMin?: number;
  cancelled?: boolean;
  sequence?: number;
  location?: string;
}

/** A person at a customer (plan K-8). */
export interface CustomerContact {
  id: string;
  customerId: string;
  name: string;
  email: string;
  phone: string;
}

/** Every reply and proposal, kept even when it no longer applies (ADR 0021). */
export interface MeetingResponse {
  id: string;
  meetingId: string;
  attendeeId: string;
  method: "reply" | "counter";
  partStat: Attendee["partStat"];
  proposedStart: string | null;
  note: string;
  sequence: number;
  at: string;
  stale: boolean;
}
