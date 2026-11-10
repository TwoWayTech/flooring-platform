"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { daysBetween, type TimeOffPolicy } from "@workspace/shared";
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
import { api } from "@/lib/api";
import { Pick } from "./pick";

/** A day off counts as 8 hours against the balance. */
const HOURS_PER_DAY = 8;

/** Asks for time off: policy, dates, hours and an optional note; it starts as pending (spec C2). */
export function RequestTimeOffDialog({
  employeeId,
  policies,
  onClose,
}: {
  employeeId: string;
  policies: readonly TimeOffPolicy[];
  onClose: () => void;
}) {
  const today = api.today();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [policyId, setPolicyId] = useState(policies[0]?.id ?? "");
  const [hours, setHours] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const days = end >= start ? daysBetween(start, end) + 1 : 1;
  const shownHours = hours ?? String(days * HOURS_PER_DAY);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api.requestTimeOff({ employeeId, policyId, start, end, hours: shownHours, note });
      toast.success("Time-off request sent");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send this request.");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Request time off</DialogTitle>
            <DialogDescription>Your manager reviews it; you see the answer here.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pto-start" label="First day">
              <Input id="pto-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
            </Field>
            <Field id="pto-end" label="Last day">
              <Input id="pto-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </Field>
            <Field id="pto-kind" label="Type">
              <Pick
                id="pto-kind"
                value={policyId}
                onChange={setPolicyId}
                options={policies.map((p) => [p.id, p.name] as const)}
              />
            </Field>
            <Field id="pto-hours" label="Hours">
              <Input
                id="pto-hours"
                inputMode="decimal"
                value={shownHours}
                onChange={(e) => setHours(e.target.value.replace(/[^\d.]/g, ""))}
              />
            </Field>
            <Field id="pto-note" label="Note" className="sm:col-span-2">
              <Input id="pto-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          {error ? (
            <p role="alert" className="text-danger-ink text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Send request</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
