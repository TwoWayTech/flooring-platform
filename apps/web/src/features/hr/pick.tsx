"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";

/** A select over labelled options, used by the HR forms. */
export function Pick<T extends string>({
  id,
  value,
  options,
  onChange,
  label,
}: {
  id?: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  /** The accessible name when no visible label points at this control. */
  label?: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger id={id} className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, text]) => (
          <SelectItem key={v} value={v}>
            {text}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
