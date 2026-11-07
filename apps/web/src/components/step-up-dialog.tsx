"use client";

import { useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
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

interface StepUpDialogProps {
  open: boolean;
  /** What is being confirmed, e.g. "Save role Sales". */
  action: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
}

/**
 * Simulated step-up MFA (blueprint rule 5): changing a role, a user's roles or MFA settings asks
 * for a fresh authenticator code. Any six digits pass in the demo.
 */
export function StepUpDialog({ open, action, onOpenChange, onConfirm }: StepUpDialogProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setPending(true);
    try {
      await onConfirm();
      setCode("");
      setError(null);
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-sm">
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="text-brand-ink size-5" />
              Confirm it is you
            </DialogTitle>
            <DialogDescription>{action} needs a fresh code from your authenticator app.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="step-up-code">Authenticator code</Label>
            <Input
              id="step-up-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-invalid={error ? true : undefined}
              aria-describedby="step-up-hint"
              className="tracking-[0.3em] tabular-nums placeholder:tracking-normal"
              placeholder="6 digits"
            />
            <p id="step-up-hint" className={error ? "text-danger-ink text-xs" : "text-muted-foreground text-xs"}>
              {error ?? "Demo: any 6 digits work."}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Confirm
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
