/** A meeting attendee: staff, customer or supplier. */
export interface Attendee {
  kind: "staff" | "customer" | "supplier";
  id: string;
  name: string;
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
  /** Occurrences moved, resized or cancelled on their own, by the date-time the series planned them. */
  exceptions: MeetingException[];
}

/** One occurrence of a series changed on its own (spec F "this event"). */
export interface MeetingException {
  planned: string;
  start?: string;
  durationMin?: number;
  cancelled?: boolean;
}
