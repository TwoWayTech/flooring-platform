"use client";

import { Save, Undo2 } from "lucide-react";
import { Button } from "@workspace/ui/components/button";

interface SaveBarProps {
  /** How many settings differ from the saved ones; the bar shows only when there are some. */
  changes: number;
  saveLabel: string;
  saving?: boolean;
  /** False keeps Save disabled, for example while a brand color fails the contrast check. */
  canSave?: boolean;
  onSave: () => void;
  onDiscard: () => void;
}

/**
 * The sticky Save / Discard bar of a settings page (spec A4). It stays at the bottom of the
 * screen while there are unsaved changes, so they are never lost below the fold.
 */
export function SaveBar({ changes, saveLabel, saving = false, canSave = true, onSave, onDiscard }: SaveBarProps) {
  if (changes === 0) return null;
  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className="bg-surface border-hairline sticky bottom-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 shadow-sm"
    >
      <span className="text-sm font-medium" aria-live="polite">
        {changes === 1 ? "1 unsaved change" : `${changes} unsaved changes`}
      </span>
      <span className="flex gap-2">
        <Button type="button" variant="outline" onClick={onDiscard} disabled={saving}>
          <Undo2 />
          Discard
        </Button>
        <Button type="button" onClick={onSave} disabled={saving || !canSave}>
          <Save />
          {saveLabel}
        </Button>
      </span>
    </div>
  );
}
