"use client";

import { BLANK_VALUE, type ColumnFilter, type FilterKind } from "@workspace/shared";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";

interface FilterEditorProps {
  /** Column id, used for field ids. */
  id: string;
  label: string;
  kind: FilterKind;
  filter: ColumnFilter | undefined;
  /** The column's values, for a multi-select. */
  options: string[];
  onChange: (filter: ColumnFilter) => void;
}

/** An empty filter of a kind, the starting point of the editor. */
export function emptyFilter(kind: FilterKind): ColumnFilter {
  switch (kind) {
    case "text":
      return { kind, text: "" };
    case "select":
      return { kind, values: [] };
    case "range":
      return { kind, min: "", max: "" };
    case "date":
      return { kind, from: "", to: "" };
  }
}

/** Two bound fields side by side: Min and Max, or From and To. */
function Bounds({
  id,
  label,
  type,
  low,
  high,
  onLow,
  onHigh,
}: {
  id: string;
  label: string;
  type: "number" | "date";
  low: string;
  high: string;
  onLow: (v: string) => void;
  onHigh: (v: string) => void;
}) {
  const [lowLabel, highLabel] = type === "date" ? ["From", "To"] : ["Min", "Max"];
  const field = (which: "low" | "high", text: string, value: string, set: (v: string) => void) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`${id}-${which}`} className="text-xs">
        {text}
      </Label>
      <Input
        id={`${id}-${which}`}
        type={type === "date" ? "date" : "text"}
        inputMode={type === "number" ? "decimal" : undefined}
        aria-label={`${label}, ${text.toLowerCase()}`}
        value={value}
        onChange={(e) => set(type === "number" ? e.target.value.replace(/[^\d.-]/g, "") : e.target.value)}
        className="h-8"
      />
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-2">
      {field("low", lowLabel, low, onLow)}
      {field("high", highLabel, high, onHigh)}
    </div>
  );
}

/** The filter control for one column (spec A2): text contains, a value list, or a range. */
export function FilterEditor({ id, label, kind, filter, options, onChange }: FilterEditorProps) {
  const current = filter ?? emptyFilter(kind);
  const fieldId = `filter-${id}`;
  switch (current.kind) {
    case "text":
      return (
        <div className="flex flex-col gap-1">
          <Label htmlFor={fieldId} className="text-xs">
            Contains
          </Label>
          <Input
            id={fieldId}
            aria-label={`${label} contains`}
            value={current.text}
            onChange={(e) => onChange({ ...current, text: e.target.value })}
            className="h-8"
          />
        </div>
      );
    case "select":
      return (
        <fieldset className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
          <legend className="sr-only">{label} values</legend>
          {options.map((option) => {
            const checked = current.values.includes(option);
            return (
              <label key={option || "blank"} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(on) =>
                    onChange({
                      ...current,
                      values: on ? [...current.values, option] : current.values.filter((v) => v !== option),
                    })
                  }
                />
                {option === BLANK_VALUE ? <span className="text-muted-foreground">(blank)</span> : option}
              </label>
            );
          })}
        </fieldset>
      );
    case "range":
      return (
        <Bounds
          id={fieldId}
          label={label}
          type="number"
          low={current.min}
          high={current.max}
          onLow={(min) => onChange({ ...current, min })}
          onHigh={(max) => onChange({ ...current, max })}
        />
      );
    case "date":
      return (
        <Bounds
          id={fieldId}
          label={label}
          type="date"
          low={current.from}
          high={current.to}
          onLow={(from) => onChange({ ...current, from })}
          onHigh={(to) => onChange({ ...current, to })}
        />
      );
  }
}
