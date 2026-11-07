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
}
