"use client";

import { useState, type ReactNode } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { StepUpDialog } from "@/components/step-up-dialog";

interface SectionFormProps<T> {
  title: string;
  initial: T;
  /** Base currency and tax changes need a step-up code (blueprint "Localization", rule 4). */
  stepUp?: boolean;
  onSave: (value: T) => Promise<void>;
  children: (draft: T, setDraft: (next: T) => void) => ReactNode;
}

/** One tab of Localization and tax: a local draft with its own Save, optionally behind step-up MFA. */
export function SectionForm<T>({ title, initial, stepUp = false, onSave, children }: SectionFormProps<T>) {
  const [draft, setDraft] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);

  async function save() {
    await onSave(draft);
    setConfirming(false);
    toast.success(`${title} saved`);
  }

  return (
    <div className="flex flex-col gap-5">
      {children(draft, setDraft)}
      <div className="flex justify-end">
        <Button onClick={() => (stepUp ? setConfirming(true) : void save())} disabled={!dirty}>
          <Save />
          Save {title.toLowerCase()}
        </Button>
      </div>
      {stepUp ? (
        <StepUpDialog
          open={confirming}
          action={`Saving ${title.toLowerCase()}`}
          onOpenChange={setConfirming}
          onConfirm={save}
        />
      ) : null}
    </div>
  );
}
