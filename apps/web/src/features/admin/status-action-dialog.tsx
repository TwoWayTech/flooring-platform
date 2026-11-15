"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  COMPANY_STATUS_ACTION_LABELS,
  statusActionText,
  type CompanyStatusAction,
  type CompanyStatusNext,
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
import { StepUpDialog } from "@/components/step-up-dialog";
import { api } from "@/lib/api";
import { isDemoMode } from "@/lib/data-source";
import { useFormatDate } from "@/lib/use-format-date";
import { ReasonField } from "./reason-field";
import {
  refusalClosesDialog,
  statusDoneText,
  statusStep,
  type StatusDraft,
  type StatusField,
} from "./status-action-flow";

interface StatusActionDialogProps {
  company: { id: string; name: string };
  action: CompanyStatusAction;
  /** What the preview says the action gives. */
  next: CompanyStatusNext;
  /** The status text the preview read, sent back as `expectedStatus`. */
  expectedStatus: string;
  onClose: () => void;
  /** The action went through: read the company and its status again. */
  onChanged: () => void;
  /** The server refused with 409 or 422: read again, since another admin may have acted. */
  onRefused: () => void;
}

/**
 * Suspend, reinstate or cancel a company (docs/specs/platform-admin.md, part 2, "The status
 * dialog"): the title and body from `statusActionText` on the preview's `next`, the reason, and
 * for cancel the company's name typed exactly. Continue runs the shared input check, then the
 * step-up in api mode, then the call. A 409 or 422 shows its message, closes and reads again; any
 * other failure brings the form back with what was typed.
 */
export function StatusActionDialog({
  company,
  action,
  next,
  expectedStatus,
  onClose,
  onChanged,
  onRefused,
}: StatusActionDialogProps) {
  const formatDate = useFormatDate();
  const [draft, setDraft] = useState<StatusDraft>({ reason: "", confirmName: "" });
  const [error, setError] = useState<{ field: StatusField | null; message: string } | null>(null);
  const [stage, setStage] = useState<"form" | "confirm">("form");
  const [pending, setPending] = useState(false);
  const text = statusActionText(action, next, company.name, (iso) => formatDate(iso));
  const destructive = action === "cancel";

  async function send() {
    const step = statusStep(action, draft, expectedStatus, company.name);
    if (!step.ok) return;
    setPending(true);
    try {
      await api.changePlatformCompanyStatus(company.id, step.input);
      toast.success(statusDoneText(action, company.name));
      onChanged();
      onClose();
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "The status was not changed.");
      if (refusalClosesDialog(failure)) {
        onRefused();
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
    const step = statusStep(action, draft, expectedStatus, company.name);
    if (!step.ok) {
      setError({ field: step.field, message: step.message });
      if (step.field) document.getElementById(`status-${step.field === "reason" ? "reason" : "confirm-name"}`)?.focus();
      return;
    }
    setError(null);
    if (isDemoMode()) void send();
    else setStage("confirm");
  }

  const nameInvalid = error?.field === "confirmName";
  return (
    <>
      <Dialog open={stage === "form"} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{text.title}</DialogTitle>
              <DialogDescription>{text.body}</DialogDescription>
            </DialogHeader>
            {error && error.field === null ? (
              <p role="alert" className="bg-danger/12 text-danger-ink rounded-md px-3 py-2 text-sm">
                {error.message}
              </p>
            ) : null}
            <ReasonField
              idPrefix="status"
              value={draft.reason}
              onChange={(reason) => setDraft({ ...draft, reason })}
              error={error?.field === "reason" ? error.message : null}
            />
            {action === "cancel" ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="status-confirm-name">Type {company.name} to confirm</Label>
                <Input
                  id="status-confirm-name"
                  value={draft.confirmName}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setDraft({ ...draft, confirmName: e.target.value })}
                  aria-invalid={nameInvalid ? true : undefined}
                  aria-describedby={nameInvalid ? "status-confirm-name-error" : undefined}
                />
                {nameInvalid ? (
                  <p id="status-confirm-name-error" className="text-danger-ink text-xs">
                    {error.message}
                  </p>
                ) : null}
              </div>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Go back
              </Button>
              <Button
                type="submit"
                variant={destructive ? "destructive" : "default"}
                // As on the Status page: the danger ink keeps the text at AA contrast on the red tint.
                className={destructive ? "text-danger-ink" : undefined}
                disabled={pending}
              >
                Continue
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <StepUpDialog
        open={stage === "confirm"}
        action={`${COMPANY_STATUS_ACTION_LABELS[action]} ${company.name}`}
        onOpenChange={(open) => !open && setStage("form")}
        onConfirm={send}
      />
    </>
  );
}
