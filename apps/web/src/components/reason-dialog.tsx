"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Textarea } from "@workspace/ui/components/textarea";
import { Field } from "./field";

interface ReasonDialogProps {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** A destructive action gets the danger button. */
  destructive?: boolean;
  onConfirm: (reason: string) => Promise<unknown>;
  onClose: () => void;
}

/**
 * Asks why before a correction that the audit log keeps (spec Appendix A: reject, void and
 * write-off need a reason). The reason must say something; errors from the store become a toast
 * with Try again.
 */
export function ReasonDialog({ title, description, confirmLabel, destructive, onConfirm, onClose }: ReasonDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (reason.trim().length < 3) {
      setError("Give a short reason; it goes to the audit log.");
      document.getElementById("reason-text")?.focus();
      return;
    }
    setPending(true);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Not saved.", {
        action: { label: "Try again", onClick: () => void submit() },
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <Field id="reason-text" label="Reason">
            <Textarea
              id="reason-text"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? "reason-text-error" : undefined}
            />
            {error ? (
              <p id="reason-text-error" className="text-danger-ink text-xs">
                {error}
              </p>
            ) : null}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={pending}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
