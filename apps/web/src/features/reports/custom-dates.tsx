"use client";

import { REPORT_YEARS } from "@workspace/shared";
import { Input } from "@workspace/ui/components/input";
import type { CustomPeriod, PeriodDays } from "./custom-period";

const PROBLEM_ID = "business-custom-dates-problem";

interface CustomDatesProps {
  period: CustomPeriod;
  /** Called with the day the person changed; the caller applies it through `editCustomPeriod`. */
  onChange: (change: Partial<PeriodDays>) => void;
}

/**
 * The Business report's From and To inputs with their check beside them (spec F2; ADR 0055 S8;
 * design brief "inline validation"). A pair the API would refuse is explained here and never sent,
 * so the report keeps the last figures and the dates they belong to instead of failing to load.
 * The message sits in a polite live region spanning the filter grid's row, so it is announced
 * once the person stops typing and takes no space while the dates are fine.
 */
export function CustomDates({ period, onChange }: CustomDatesProps) {
  const invalid = period.problem !== null;
  const describedBy = invalid ? { "aria-invalid": true, "aria-describedby": PROBLEM_ID } : {};
  const bounds = { min: `${REPORT_YEARS.from}-01-01`, max: `${REPORT_YEARS.to}-12-31` };
  return (
    <>
      <Input
        type="date"
        aria-label="From"
        {...bounds}
        value={period.typed.from}
        onChange={(e) => onChange({ from: e.target.value })}
        {...describedBy}
      />
      <Input
        type="date"
        aria-label="To"
        {...bounds}
        value={period.typed.to}
        onChange={(e) => onChange({ to: e.target.value })}
        {...describedBy}
      />
      <p id={PROBLEM_ID} aria-live="polite" className={invalid ? "text-danger-ink col-span-full text-sm" : "sr-only"}>
        {invalid ? `${period.problem} The figures below still show the last dates that worked.` : null}
      </p>
    </>
  );
}
