"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { Invoice } from "@workspace/shared";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Field } from "@/components/field";
import { hourLabel } from "@/features/installation/job-status";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";

const HOURS = Array.from({ length: 10 }, (_, i) => i + 7);

/** The crew, day and start hour of a new installation job; the store costs it from the invoice. */
function ScheduleJobDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const crews = useApiQuery((client) => client.list("crews"), []);
  const [crewId, setCrewId] = useState("");
  const [date, setDate] = useState(api.today());
  const [hour, setHour] = useState("8");
  const [pending, setPending] = useState(false);
  const chosen = crewId || crews.data?.[0]?.id || "";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const job = await api.scheduleJob({ invoiceId: invoice.id, crewId: chosen, date, startHour: Number(hour) });
      toast.success(`${job.number} scheduled`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The job was not scheduled.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Schedule installation</DialogTitle>
            <DialogDescription>
              A job for {invoice.number} at the job site, costed from the invoice&apos;s materials and labor.
            </DialogDescription>
          </DialogHeader>
          <Field id="job-crew" label="Crew">
            <Select value={chosen} onValueChange={setCrewId}>
              <SelectTrigger id="job-crew" className="w-full">
                <SelectValue placeholder="Loading crews" />
              </SelectTrigger>
              <SelectContent>
                {(crews.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="job-date" label="Day">
              <Input
                id="job-date"
                type="date"
                min={api.today()}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </Field>
            <Field id="job-hour" label="Start">
              <Select value={hour} onValueChange={setHour}>
                <SelectTrigger id="job-hour" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {hourLabel(h)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !chosen}>
              Schedule job
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** "Schedule installation" in the invoice header when the sale has no job yet (feature batch 2, H flow 1). */
export function ScheduleJob({ invoice }: { invoice: Invoice }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="link" className="text-brand-ink h-auto p-0" onClick={() => setOpen(true)}>
        Schedule installation
      </Button>
      {open ? <ScheduleJobDialog invoice={invoice} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
