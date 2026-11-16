"use client";

import type { Ref } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";

interface NewerHoursNoticeProps {
  /** The newer saved hours, one per day of the week. */
  days: readonly number[];
  /** The week's day headings, in the form's order. */
  headings: readonly string[];
  /** A save or submit is running, so neither choice is offered yet. */
  busy: boolean;
  /** "Use saved hours": the typed hours are dropped. */
  onUse: () => void;
  /** "Keep my hours": the next save replaces the saved hours. */
  onKeep: () => void;
  /** The first button, which takes focus when the notice appears. */
  firstButton: Ref<HTMLButtonElement>;
}

/**
 * Newer hours saved for the week the person is editing, by an upload, the clock or another tab
 * (employee-portal.md "Weekly hours"; ADR 0051, 2026-11-16). It shows the saved days beside the
 * typed ones and asks which to keep; Save and Submit wait for the choice, so typed hours never
 * replace newer ones unseen.
 */
export function NewerHoursNotice({ days, headings, busy, onUse, onKeep, firstButton }: NewerHoursNoticeProps) {
  return (
    <div role="status" className="text-warning-ink bg-warning/14 flex flex-col gap-3 rounded-md p-3 text-sm">
      <p className="flex gap-2 font-medium">
        <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        Newer hours were saved for this week.
      </p>
      <dl className="grid grid-cols-4 gap-x-2 gap-y-1 sm:grid-cols-7">
        {headings.map((heading, i) => (
          <div key={heading} className="flex flex-col items-center">
            <dt className="text-xs">{heading}</dt>
            <dd className="tabular-nums">
              <Num kind="quantity" value={days[i] ?? 0} />
            </dd>
          </div>
        ))}
      </dl>
      <p>Use saved hours drops your changes. Keep my hours replaces the saved hours when you save.</p>
      <div className="flex flex-wrap gap-2">
        <Button ref={firstButton} size="sm" disabled={busy} onClick={onUse}>
          Use saved hours
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onKeep}>
          Keep my hours
        </Button>
      </div>
    </div>
  );
}
