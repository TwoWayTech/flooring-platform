"use client";

import { cn } from "@workspace/ui/lib/utils";

interface SegmentedProps<T extends string> {
  /** Names the group for assistive technology, for example "Show" or "Network". */
  label: string;
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
  className?: string;
}

/**
 * A row of toggle buttons where exactly one is on, styled like the tab list. Use it to filter or
 * switch a mode in place; use Tabs only when each choice shows its own panel.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "md",
  className,
}: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "bg-muted text-muted-foreground inline-flex w-fit items-center rounded-lg p-[3px]",
        size === "sm" ? "h-7" : "h-8",
        className,
      )}
    >
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={key === value}
          onClick={() => onChange(key)}
          className={cn(
            "hover:text-foreground aria-pressed:bg-background aria-pressed:text-foreground h-full rounded-md font-medium whitespace-nowrap transition-colors",
            size === "sm" ? "px-2 text-xs" : "px-2.5 text-sm",
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}
