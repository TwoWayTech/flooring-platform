"use client";

import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { StepUpDialog } from "./step-up-dialog";

interface Waiting {
  /** What is being confirmed, e.g. "Refunding customer credit". */
  action: string;
  run: () => Promise<void>;
}

/**
 * Asks for a fresh authenticator code before an action the API steps up (ADR 0063), with the shared
 * `StepUpDialog`. `ask` opens the dialog; once the code passes, the action runs. An action's own
 * refusal is shown in a toast, as the screens show other refusals. Render `dialog` once.
 */
export function useStepUp(): { ask: (action: string, run: () => Promise<void>) => void; dialog: ReactNode } {
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  // The words stay while the dialog closes.
  const [action, setAction] = useState("This change");

  function ask(next: string, run: () => Promise<void>) {
    setAction(next);
    setWaiting({ action: next, run });
  }

  async function confirmed() {
    const run = waiting?.run;
    setWaiting(null);
    try {
      await run?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That did not work.");
    }
  }

  const dialog = (
    <StepUpDialog
      open={waiting !== null}
      action={action}
      onOpenChange={(open) => {
        if (!open) setWaiting(null);
      }}
      onConfirm={confirmed}
    />
  );
  return { ask, dialog };
}
