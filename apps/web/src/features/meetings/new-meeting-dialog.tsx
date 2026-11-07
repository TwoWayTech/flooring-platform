"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { Attendee, Customer, Meeting, Supplier, User } from "@workspace/shared";
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
const NONE = "none";

interface NewMeetingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: User[];
  customers: Customer[];
  suppliers: Supplier[];
}

/** Schedules a meeting with staff and, optionally, a customer or supplier; it can repeat and remind. */
export function NewMeetingDialog({ open, onOpenChange, users, customers, suppliers }: NewMeetingDialogProps) {
  const { user } = useWorkspace();
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(api.today());
  const [time, setTime] = useState("09:00");
  const [duration, setDuration] = useState("30");
  const [location, setLocation] = useState("Conference room");
  const [staff, setStaff] = useState<string[]>([user.id]);
  const [customerId, setCustomerId] = useState(NONE);
  const [supplierId, setSupplierId] = useState(NONE);
  const [recurrence, setRecurrence] = useState<Meeting["recurrence"]>("none");
  const [reminder, setReminder] = useState<keyof typeof REMINDERS>("15");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return toast.error("Give the meeting a title.");
    const attendees: Attendee[] = [
      ...users.filter((u) => staff.includes(u.id)).map((u) => ({ kind: "staff" as const, id: u.id, name: u.name })),
      ...customers
        .filter((c) => c.id === customerId)
        .map((c) => ({ kind: "customer" as const, id: c.id, name: c.name })),
      ...suppliers
        .filter((s) => s.id === supplierId)
        .map((s) => ({ kind: "supplier" as const, id: s.id, name: s.name })),
    ];
    const meeting: Meeting = {
      id: `mtg-${crypto.randomUUID().slice(0, 8)}`,
      title: title.trim(),
      start: `${date}T${time}`,
      durationMin: Number(duration),
      location,
      attendees,
      recurrence,
      reminderMin: Number(reminder),
      ownerUserId: user.id,
      notes: "",
    };
    await api.save("meetings", meeting, {
      category: "data",
      action: "Scheduled meeting",
      target: meeting.title,
      before: null,
      after: `${date} ${time}, ${RECURRENCE[recurrence].toLowerCase()}`,
    });
    toast.success(`Meeting ${meeting.title} scheduled`);
    setTitle("");
    onOpenChange(false);
  }

  const options = <T extends { id: string; name: string }>(items: T[]) =>
    items.map((i) => (
      <SelectItem key={i.id} value={i.id}>
        {i.name}
      </SelectItem>
    ));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New meeting</DialogTitle>
            <DialogDescription>Attendees get a reminder before it starts.</DialogDescription>
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
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Staff</legend>
            <div className="grid max-h-36 grid-cols-2 gap-2 overflow-y-auto">
              {users
                .filter((u) => u.status === "active")
                .map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={staff.includes(u.id)}
                      onCheckedChange={(on) => setStaff(on ? [...staff, u.id] : staff.filter((s) => s !== u.id))}
                    />
                    {u.name}
                  </label>
                ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            {customers.length > 0 ? (
              <Field id="mtg-customer" label="Customer">
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger id="mtg-customer" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NONE}>No customer</SelectItem>
                    {options(customers)}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
            {suppliers.length > 0 ? (
              <Field id="mtg-supplier" label="Supplier">
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger id="mtg-supplier" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value={NONE}>No supplier</SelectItem>
                    {options(suppliers)}
                  </SelectContent>
                </Select>
              </Field>
            ) : null}
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
