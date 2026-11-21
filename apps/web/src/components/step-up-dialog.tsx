"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { featureOn } from "@workspace/shared";
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
import { api } from "@/lib/api";
import { ApiError } from "@/lib/api/errors";
import { isDemoMode } from "@/lib/data-source";

interface StepUpDialogProps {
  open: boolean;
  /** What is being confirmed, e.g. "Save role Sales". */
  action: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void> | void;
  /** A consequence to read before confirming, e.g. that a role's users must set up two-step sign-in. */
  notice?: string | null;
}

/** Confirms once per opening, without asking for a code, while the auth.step-up feature is off. */
function useSkipWhenSwitchedOff(
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onConfirm: () => Promise<void> | void,
): boolean {
  // The real API always requires the step-up, so only the demo honours the switch.
  const skip = !featureOn("auth.step-up") && isDemoMode();
  const confirmed = useRef(false);
  useEffect(() => {
    if (!skip) return;
    if (!open) {
      confirmed.current = false;
      return;
    }
    if (confirmed.current) return;
    confirmed.current = true;
    void Promise.resolve(onConfirm()).finally(() => onOpenChange(false));
  }, [skip, open, onConfirm, onOpenChange]);
  return skip;
}

/**
 * Step-up MFA (blueprint rule 5; draft spec docs/specs/settings-users-access.md): changing a
 * role, a user's roles or MFA settings asks for a fresh authenticator code, checked by the API
 * (`verifyStepUp`) before the change is sent. Any six digits pass in the demo. With the
 * auth.step-up feature switched off, the demo confirms at once.
 */
export function StepUpDialog({ open, action, onOpenChange, onConfirm, notice }: StepUpDialogProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const skipped = useSkipWhenSwitchedOff(open, onOpenChange, onConfirm);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setPending(true);
    try {
      await api.verifyStepUp(code);
      await onConfirm();
      setCode("");
      setError(null);
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(failure.message);
    } finally {
      setPending(false);
    }
  }

  if (skipped) return null;
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
          {notice ? (
            <p role="note" className="text-warning-ink bg-warning/14 flex gap-2 rounded-md p-3 text-sm">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {notice}
            </p>
          ) : null}
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
              {error ?? (isDemoMode() ? "Demo: any 6 digits work." : "The code changes every 30 seconds.")}
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
