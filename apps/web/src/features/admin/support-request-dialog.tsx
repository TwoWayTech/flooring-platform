"use client";

import { useRef, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  formatNumber,
  SUPPORT_HOURS,
  SUPPORT_LIMIT_MESSAGE,
  SUPPORT_OPEN_MESSAGE,
  SUPPORT_REASON,
  SUPPORT_REASON_MESSAGE,
  supportRequestInputProblem,
  type SupportRequestInput,
} from "@workspace/shared";
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
import { Label } from "@workspace/ui/components/label";
import { useNumberSettings } from "@workspace/ui/components/number-settings";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { StepUpDialog } from "@/components/step-up-dialog";
import { api } from "@/lib/api";
import { isDemoMode } from "@/lib/data-source";

/** The hours a new request starts with (spec part 3, "Ask for support access"). */
const DEFAULT_HOURS = "4";

/** The limits' refusals (409 and 429), which the API and the demo word the same way. */
const LIMIT_REFUSALS: readonly string[] = [SUPPORT_OPEN_MESSAGE, SUPPORT_LIMIT_MESSAGE];

type FieldName = "reason" | "hours";

interface SupportRequestDialogProps {
  company: { id: string; name: string };
  onClose: () => void;
  /** Reads the list again, where the data layer does not tell screens itself. */
  onRequested: () => void;
}

/**
 * Ask for support access (docs/specs/platform-admin.md, part 3, "Screens"): a reason of 10 to 500
 * characters and 1 to 72 hours, checked with the API's shared rule before anything is sent; the
 * field in error is marked and gets focus. In api mode Continue closes the form and asks for a
 * fresh authenticator code, as every platform write needs; the demo sends at once, like its access
 * save. A refusal by the limits (an open request, the 24-hour limit) shows the API's message, closes
 * the form and reads the list again; any other failure shows its message and brings the form back
 * with what was typed.
 */
export function SupportRequestDialog({ company, onClose, onRequested }: SupportRequestDialogProps) {
  const settings = useNumberSettings();
  const [reason, setReason] = useState("");
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [error, setError] = useState<{ field: FieldName; message: string } | null>(null);
  const [stage, setStage] = useState<"form" | "confirm">("form");
  const [pending, setPending] = useState(false);
  const reasonField = useRef<HTMLTextAreaElement>(null);
  const hoursField = useRef<HTMLInputElement>(null);
  const length = reason.trim().length;

  function request(): SupportRequestInput {
    return { companyId: company.id, reason: reason.trim(), hours: Number(hours) };
  }

  async function send() {
    setPending(true);
    try {
      await api.requestSupportAccess(request());
      toast.success(`Support access requested. ${company.name}'s Owner approves it in Settings.`);
      onRequested();
      onClose();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "The request was not sent.";
      toast.error(message);
      if (LIMIT_REFUSALS.includes(message)) {
        // Another tab or admin session asked meanwhile, so the list (and the button) is read again.
        onRequested();
        onClose();
      } else {
        setStage("form");
      }
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = supportRequestInputProblem(request());
    if (problem) {
      const field: FieldName = problem === SUPPORT_REASON_MESSAGE ? "reason" : "hours";
      setError({ field, message: problem });
      (field === "reason" ? reasonField : hoursField).current?.focus();
      return;
    }
    setError(null);
    if (isDemoMode()) void send();
    else setStage("confirm");
  }

  const describedBy = (field: FieldName, ...ids: string[]) =>
    [...ids, error?.field === field ? `support-${field}-error` : null].filter(Boolean).join(" ");

  return (
    <>
      <Dialog open={stage === "form"} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="bg-surface sm:max-w-md">
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Ask for support access</DialogTitle>
              <DialogDescription>
                {company.name}&apos;s Owner gets the request and approves or revokes it. Approved access is read only
                and ends after the hours you set.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="support-reason">Reason</Label>
              <Textarea
                ref={reasonField}
                id="support-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-invalid={error?.field === "reason" ? true : undefined}
                aria-describedby={describedBy("reason", "support-reason-hint", "support-reason-count")}
              />
              <div className="flex items-start justify-between gap-3 text-xs">
                <p id="support-reason-hint" className="text-muted-foreground">
                  Don&apos;t paste the company&apos;s data here: the reason is kept in the platform audit log.
                </p>
                <p
                  id="support-reason-count"
                  className={cn(
                    "shrink-0 tabular-nums",
                    length > SUPPORT_REASON.max ? "text-danger-ink" : "text-muted-foreground",
                  )}
                >
                  {formatNumber(length, "count", settings)} of {formatNumber(SUPPORT_REASON.max, "count", settings)}
                </p>
              </div>
              {error?.field === "reason" ? (
                <p id="support-reason-error" className="text-danger-ink text-xs">
                  {error.message}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="support-hours">Hours</Label>
              <Input
                ref={hoursField}
                id="support-hours"
                type="number"
                inputMode="numeric"
                min={SUPPORT_HOURS.min}
                max={SUPPORT_HOURS.max}
                step={1}
                value={hours}
                onChange={(e) => setHours(e.target.value)}
                className="w-28"
                aria-invalid={error?.field === "hours" ? true : undefined}
                aria-describedby={describedBy("hours", "support-hours-hint")}
              />
              <p id="support-hours-hint" className="text-muted-foreground text-xs">
                From {formatNumber(SUPPORT_HOURS.min, "count", settings)} to{" "}
                {formatNumber(SUPPORT_HOURS.max, "count", settings)}. Access ends this long after the request.
              </p>
              {error?.field === "hours" ? (
                <p id="support-hours-error" className="text-danger-ink text-xs">
                  {error.message}
                </p>
              ) : null}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                Continue
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <StepUpDialog
        open={stage === "confirm"}
        action={`Asking ${company.name} for support access`}
        onOpenChange={(open) => !open && setStage("form")}
        onConfirm={send}
      />
    </>
  );
}
