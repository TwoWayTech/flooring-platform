"use client";

import { useState } from "react";
import { CalendarPlus, Check, CircleHelp, Clock, Download, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { Attendee, Meeting, User } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Field } from "@/components/field";
import { downloadText } from "@/components/data-table/csv";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { Pick } from "@/features/hr/pick";
import { api } from "@/lib/api";
import type { ReplyInput } from "@/lib/api/contract";

const STATE_LABEL: Record<Attendee["partStat"], string> = {
  accepted: "Accepted",
  tentative: "Maybe",
  declined: "Declined",
  "needs-action": "No reply yet",
};

/** How a guest has answered, in words. */
export const answerLabel = (a: Attendee) => STATE_LABEL[a.partStat];

async function run(work: Promise<unknown>, done: string) {
  try {
    await work;
    toast.success(done);
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "That did not work.");
  }
}

/** Picks a new date and time to propose. */
function ProposeDialog({
  meeting,
  onSend,
  onClose,
}: {
  meeting: Meeting;
  onSend: (start: string, note: string) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(meeting.start.slice(0, 10));
  const [time, setTime] = useState(meeting.start.slice(11, 16));
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Propose a new time</DialogTitle>
          <DialogDescription>The meeting does not move unless the organiser accepts.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pro-date" label="Date">
            <Input id="pro-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field id="pro-time" label="Start">
            <Input id="pro-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field id="pro-note" label="Note" className="sm:col-span-2">
            <Input id="pro-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSend(`${date}T${time}`, note)}>Send proposal</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The four answers, shared by the meeting drawer and Simulate reply in the Outbox (spec E). */
export function ReplyButtons({ meeting, send }: { meeting: Meeting; send: (reply: ReplyInput, done: string) => void }) {
  const [proposing, setProposing] = useState(false);
  const canPropose = meeting.allowProposals && meeting.recurrence === "none";
  return (
    <div className="flex flex-wrap gap-1.5">
      <Button
        size="sm"
        variant="outline"
        onClick={() => send({ partStat: "accepted", note: "", proposal: null }, "Accepted")}
      >
        <Check />
        Accept
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => send({ partStat: "tentative", note: "", proposal: null }, "Marked as maybe")}
      >
        <CircleHelp />
        Maybe
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => send({ partStat: "declined", note: "", proposal: null }, "Declined")}
      >
        <X />
        Decline
      </Button>
      {canPropose ? (
        <Button size="sm" variant="ghost" onClick={() => setProposing(true)}>
          <Clock />
          Propose a new time
        </Button>
      ) : null}
      {proposing ? (
        <ProposeDialog
          meeting={meeting}
          onClose={() => setProposing(false)}
          onSend={(start, note) => {
            setProposing(false);
            send(
              { partStat: "tentative", note, proposal: { start, durationMin: meeting.durationMin, note } },
              "Proposal sent",
            );
          }}
        />
      ) : null}
    </div>
  );
}

/** Edits a meeting's details (spec E). A new place asks every guest again; a title or notes change does not. */
function EditMeetingDialog({ meeting, onClose }: { meeting: Meeting; onClose: () => void }) {
  const [title, setTitle] = useState(meeting.title);
  const [location, setLocation] = useState(meeting.location);
  const [notes, setNotes] = useState(meeting.notes);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit meeting</DialogTitle>
          <DialogDescription>Guests get an updated invite.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field id="edit-title" label="Title">
            <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field id="edit-where" label="Where">
            <Input id="edit-where" value={location} onChange={(e) => setLocation(e.target.value)} />
          </Field>
          <Field id="edit-notes" label="Notes">
            <Input id="edit-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim()}
            onClick={() => {
              void run(api.updateMeeting(meeting.id, { title: title.trim(), location, notes }), "Meeting updated");
              onClose();
            }}
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The drawer's guest list and actions (spec E): answers, proposals, Add to my calendar and cancel. */
export function MeetingAnswers({ meeting }: { meeting: Meeting }) {
  const can = useCan();
  const { user } = useWorkspace();
  const mine = meeting.attendees.find((a) => a.kind === "staff" && a.id === user.id);
  const organiser = meeting.ownerUserId === user.id;
  const canEdit = can("meetings.meeting.edit");
  const showGuests = organiser || !meeting.hideGuestList || canEdit;
  const cancelled = meeting.status === "cancelled";
  const [editing, setEditing] = useState(false);

  async function addToCalendar() {
    const { fileName, text } = await api.meetingCalendarFile(meeting.id);
    downloadText(fileName, text, "text/calendar");
  }

  return (
    <div className="flex flex-col gap-4">
      {meeting.status === "tentative" ? <p className="text-warning-ink">Waiting for an answer.</p> : null}
      {cancelled ? <p className="text-danger-ink">This meeting was cancelled.</p> : null}
      {mine && !organiser && !cancelled ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">Your answer: {answerLabel(mine)}</h3>
          <ReplyButtons
            meeting={meeting}
            send={(reply, done) => void run(api.respondToMeeting(meeting.id, reply), done)}
          />
        </section>
      ) : null}
      {showGuests ? (
        <section className="flex flex-col gap-2">
          <h3 className="font-semibold">Attendees</h3>
          <ul className="flex flex-col gap-1.5">
            {meeting.attendees.map((a) => (
              <li key={`${a.kind}-${a.id}`} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {a.name}{" "}
                  {a.kind !== "staff" ? (
                    <span className="text-muted-foreground">({a.kind.replace("-", " ")})</span>
                  ) : null}
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground">{answerLabel(a)}</span>
                  {canEdit && a.id !== meeting.ownerUserId && !cancelled ? (
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={`Remove ${a.name}`}
                      onClick={() => void run(api.removeGuest(meeting.id, a.id), "Guest removed")}
                    >
                      <Trash2 />
                    </Button>
                  ) : null}
                </span>
                {a.proposal?.status === "pending" && organiser ? (
                  <span className="bg-raised flex w-full flex-wrap items-center justify-between gap-2 rounded-md p-2">
                    Proposes {a.proposal.start.replace("T", " at ")}
                    <span className="flex gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void run(api.decideProposal(meeting.id, a.id, true), "Meeting moved")}
                      >
                        Accept time
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void run(api.decideProposal(meeting.id, a.id, false), "Proposal declined")}
                      >
                        Decline time
                      </Button>
                    </span>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {!cancelled ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => void addToCalendar()}>
            <Download />
            Add to my calendar
          </Button>
          {canEdit ? (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit details
            </Button>
          ) : null}
          {canEdit ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void run(api.cancelMeeting(meeting.id), "Meeting cancelled")}
            >
              <X />
              Cancel meeting
            </Button>
          ) : null}
        </div>
      ) : null}
      {editing ? <EditMeetingDialog meeting={meeting} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}

/** Any user asks someone to meet (spec E); they accept, decline or propose another time. */
export function RequestMeetingDialog({ users, onClose }: { users: readonly User[]; onClose: () => void }) {
  const { user } = useWorkspace();
  const others = users.filter((u) => u.status === "active" && u.id !== user.id);
  const [withUserId, setWith] = useState(others[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(api.today());
  const [time, setTime] = useState("10:00");
  const [note, setNote] = useState("");
  const [isPrivate, setPrivate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    try {
      await api.requestMeeting({
        withUserId,
        title,
        start: `${date}T${time}`,
        durationMin: 30,
        location: "To be agreed",
        note,
        private: isPrivate,
      });
      toast.success("Meeting requested");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send this request.");
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request a meeting</DialogTitle>
          <DialogDescription>They can accept, decline or propose another time.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="req-with" label="With" className="sm:col-span-2">
            <Pick
              id="req-with"
              value={withUserId}
              onChange={setWith}
              options={others.map((u) => [u.id, u.name] as const)}
            />
          </Field>
          <Field id="req-title" label="About" className="sm:col-span-2">
            <Input id="req-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field id="req-date" label="Date">
            <Input id="req-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field id="req-time" label="Start">
            <Input id="req-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </Field>
          <Field id="req-note" label="Note" className="sm:col-span-2">
            <Input id="req-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
            Private: only the two of you can see it
          </label>
        </div>
        {error ? (
          <p role="alert" className="text-danger-ink text-sm">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void send()}>
            <CalendarPlus />
            Send request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
