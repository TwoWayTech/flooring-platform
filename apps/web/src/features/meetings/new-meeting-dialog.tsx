"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { Attendee, Customer, CustomerContact, Meeting, Supplier, SupplierContact, User } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Field } from "@/components/field";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import type { NewGuest } from "@/lib/api/contract";
import { GuestPicker } from "./guest-picker";

/** How each repeat choice reads. */
export const RECURRENCE: Record<Meeting["recurrence"], string> = {
  none: "Does not repeat",
  weekly: "Every week",
  biweekly: "Every two weeks",
  monthly: "Every month",
};
const REMINDERS = {
  "10": "10 minutes before",
  "15": "15 minutes before",
  "30": "30 minutes before",
  "60": "1 hour before",
} as const;

interface NewMeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: User[];
  customers: Customer[];
  contacts: CustomerContact[];
  suppliers: Supplier[];
  supplierContacts: SupplierContact[];
  /** The slot clicked on the calendar, "2026-11-09T10:00"; empty starts today at 9:00. */
  initialStart?: string;
}

/**
 * Schedules a meeting (spec E): guests from one search or by email, and each gets an invite with a
 * calendar file in the Outbox. Times can repeat; reminder defaults come from Settings → Meetings.
 */
export function NewMeetingDialog({
  open,
  onOpenChange,
  users,
  customers,
  contacts,
  suppliers,
  supplierContacts,
  initialStart,
}: NewMeetingDialogProps) {
  const { user, settings } = useWorkspace();
  const defaults = settings.meetings;
  const me: Attendee = {
    kind: "staff",
    id: user.id,
    name: user.name,
    email: user.email,
    role: "required",
    partStat: "accepted",
    respondedAt: null,
    respondedSequence: null,
    note: "",
    proposal: null,
  };
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(initialStart?.slice(0, 10) ?? api.today());
  const [time, setTime] = useState(initialStart?.slice(11, 16) ?? "09:00");
  const [duration, setDuration] = useState("30");
  const [location, setLocation] = useState("Conference room");
  const [guests, setGuests] = useState<Attendee[]>([me]);
  const [newGuests, setNewGuests] = useState<NewGuest[]>([]);
  const [recurrence, setRecurrence] = useState<Meeting["recurrence"]>("none");
  const [reminder, setReminder] = useState(String(defaults.defaultReminderMin) as keyof typeof REMINDERS);
  const [isPrivate, setPrivate] = useState(false);
  const [hideGuests, setHideGuests] = useState(defaults.hideGuestList);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const meeting = await api.createMeeting({
        title,
        start: `${date}T${time}`,
        durationMin: Number(duration),
        location,
        guests,
        newGuests,
        recurrence,
        reminderMin: Number(reminder),
        notes: "",
        private: isPrivate,
        hideGuestList: hideGuests,
        allowProposals: defaults.allowProposals,
      });
      toast.success(`Meeting ${meeting.title} scheduled`);
      setTitle("");
      setGuests([me]);
      setNewGuests([]);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not schedule this meeting.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New meeting</DialogTitle>
            <DialogDescription>Each guest gets an invite with a calendar file.</DialogDescription>
          </DialogHeader>
          <Field id="mtg-title" label="Title">
            <Input id="mtg-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="mtg-date" label="Date">
              <Input id="mtg-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field id="mtg-time" label="Start">
              <Input id="mtg-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </Field>
            <Field id="mtg-duration" label="Minutes">
              <Input
                id="mtg-duration"
                type="number"
                min={15}
                step={15}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </Field>
          </div>
          <Field id="mtg-location" label="Where">
            <Input id="mtg-location" value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <GuestPicker
            guests={guests}
            newGuests={newGuests}
            users={users}
            customers={customers}
            contacts={contacts}
            suppliers={suppliers}
            supplierContacts={supplierContacts}
            onGuests={setGuests}
            onNewGuests={setNewGuests}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="mtg-repeat" label="Repeats">
              <Select value={recurrence} onValueChange={(v) => setRecurrence(v as Meeting["recurrence"])}>
                <SelectTrigger id="mtg-repeat" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(RECURRENCE) as Meeting["recurrence"][]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {RECURRENCE[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="mtg-reminder" label="Reminder">
              <Select value={reminder} onValueChange={(v) => setReminder(v as keyof typeof REMINDERS)}>
                <SelectTrigger id="mtg-reminder" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(REMINDERS) as (keyof typeof REMINDERS)[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {REMINDERS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <Checkbox
                checked={isPrivate}
                onCheckedChange={(v) => setPrivate(v === true)}
                aria-label="Private meeting"
              />
              Private: only the people invited can see it
            </label>
            <label className="flex items-center gap-2">
              <Checkbox
                checked={hideGuests}
                onCheckedChange={(v) => setHideGuests(v === true)}
                aria-label="Hide the guest list"
              />
              Hide the guest list from guests
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Schedule meeting</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
