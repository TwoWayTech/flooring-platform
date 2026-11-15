"use client";

import type { Ref } from "react";
import { ADMIN_REASON, formatNumber } from "@workspace/shared";
import { Label } from "@workspace/ui/components/label";
import { useNumberSettings } from "@workspace/ui/components/number-settings";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";

interface ReasonFieldProps {
  /** Prefix of the field's ids: `{idPrefix}-reason`, `-reason-hint`, `-reason-count` and `-reason-error`. */
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
  /** The shared rule's message when the reason was refused, shown under the field. */
  error: string | null;
  ref?: Ref<HTMLTextAreaElement>;
}

/**
 * The reason every platform admin write carries (docs/specs/platform-admin.md, part 2, "The reason
 * field"; part 3, "Ask for support access"): a text area, a hint not to paste the company's data,
 * because the reason is kept in the platform audit log, a counter of the trimmed length against
 * `ADMIN_REASON.max`, and the error. The plan, status and support dialogs share it.
 */
export function ReasonField({ idPrefix, value, onChange, error, ref }: ReasonFieldProps) {
  const settings = useNumberSettings();
  const id = `${idPrefix}-reason`;
  const length = value.trim().length;
  const describedBy = [`${id}-hint`, `${id}-count`, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>Reason</Label>
      <Textarea
        ref={ref}
        id={id}
        rows={3}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
      />
      <div className="flex items-start justify-between gap-3 text-xs">
        <p id={`${id}-hint`} className="text-muted-foreground">
          Don&apos;t paste the company&apos;s data here: the reason is kept in the platform audit log.
        </p>
        <p
          id={`${id}-count`}
          className={cn(
            "shrink-0 tabular-nums",
            length > ADMIN_REASON.max ? "text-danger-ink" : "text-muted-foreground",
          )}
        >
          {formatNumber(length, "count", settings)} of {formatNumber(ADMIN_REASON.max, "count", settings)}
        </p>
      </div>
      {error ? (
        <p id={`${id}-error`} className="text-danger-ink text-xs">
          {error}
        </p>
      ) : null}
    </div>
  );
}
