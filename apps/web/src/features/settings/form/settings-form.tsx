"use client";

import { useState, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { StepUpDialog } from "@/components/step-up-dialog";
import { SaveBar } from "./save-bar";
import { saveSection } from "./save-section";

/** Whether two settings values differ; settings are plain data, so JSON compares them fully. */
export function differs(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** How many top-level fields of a draft differ from the saved value. */
export function changeCount<T>(draft: T, saved: T): number {
  if (typeof draft !== "object" || draft === null) return differs(draft, saved) ? 1 : 0;
  const keys = new Set([...Object.keys(draft), ...Object.keys(saved as object)]);
  return [...keys].filter((k) => differs((draft as Record<string, unknown>)[k], (saved as Record<string, unknown>)[k]))
    .length;
}

interface SettingsFormProps<T> {
  /** The section's plain title, e.g. "Sales tax"; also names the Save button and the toast. */
  title: string;
  /** One sentence saying what the section controls (spec A4). */
  description: string;
  /** False on single-section pages, whose page header already carries the title and sentence. */
  showTitle?: boolean;
  initial: T;
  /** The company's original values, for Reset to default. */
  defaults: T;
  /**
   * The save needs a step-up code: base currency and tax (blueprint "Localization", rule 4), and
   * Payments (ADR 0059 D5).
   */
  stepUp?: boolean;
  /** Extra condition for saving, such as a passing contrast check. */
  canSave?: (draft: T) => boolean;
  onSave: (value: T) => Promise<void>;
  /** The rows, given the draft, its setter and whether a top-level field has changed. */
  children: (draft: T, setDraft: (next: T) => void, changed: (key: keyof T) => boolean) => ReactNode;
}

/**
 * One settings section (spec A4): title and one sentence, the rows with changed ones marked,
 * Reset to default, and the sticky Save / Discard bar. Saving goes through the ApiClient, which
 * writes the change to the audit log; a refused save shows its message and keeps the draft.
 */
export function SettingsForm<T>({
  title,
  description,
  initial,
  defaults,
  stepUp = false,
  showTitle = true,
  canSave,
  onSave,
  children,
}: SettingsFormProps<T>) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const changes = changeCount(draft, saved);
  const changed = (key: keyof T) => differs(draft[key], saved[key]);

  async function save() {
    setSaving(true);
    try {
      // A refusal shows its words and keeps the draft, so the bar still shows the change (D16).
      if (await saveSection(draft, onSave, title, toast)) setSaved(draft);
    } finally {
      setSaving(false);
      setConfirming(false);
    }
  }

  return (
    <section aria-labelledby={`section-${title}`} className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className={showTitle ? undefined : "sr-only"}>
          <h2 id={`section-${title}`} className="font-display text-lg font-semibold">
            {title}
          </h2>
          <p className="text-muted-foreground mt-0.5 max-w-prose text-sm">{description}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          onClick={() => setDraft(defaults)}
          disabled={!differs(draft, defaults)}
        >
          <RotateCcw />
          Reset to default
        </Button>
      </div>
      {children(draft, setDraft, changed)}
      <SaveBar
        changes={changes}
        saveLabel={`Save ${title.toLowerCase()}`}
        saving={saving}
        canSave={canSave ? canSave(draft) : true}
        onSave={() => (stepUp ? setConfirming(true) : void save())}
        onDiscard={() => setDraft(saved)}
      />
      {stepUp ? (
        <StepUpDialog
          open={confirming}
          action={`Saving ${title.toLowerCase()}`}
          onOpenChange={setConfirming}
          onConfirm={save}
        />
      ) : null}
    </section>
  );
}
