"use client";

import { useMemo } from "react";
import type { FloorPattern as PatternKey } from "@workspace/shared";
import { layPattern } from "@workspace/ui/lib/floor-geometry";
import { cn } from "@workspace/ui/lib/utils";

/** Brand tones mixed into the surface, strong enough to read in a 44 px swatch. */
const STRONG_TONES = {
  1: "color-mix(in oklch, var(--brand) 38%, var(--surface))",
  2: "color-mix(in oklch, var(--brand) 55%, var(--surface))",
  3: "color-mix(in oklch, var(--brand) 72%, var(--surface))",
} as const;

/** Seconds the login laying sequence takes from first plank to last (design brief: about 1.2 s). */
const LAY_SECONDS = 1.2;

interface FloorPatternProps {
  pattern: PatternKey;
  /** Field size in px of the generated pattern; the SVG covers its box like a background. */
  width?: number;
  height?: number;
  /** Plank width in px. */
  unit?: number;
  /** Lay the planks in sequence once (login only). Reduced motion shows the floor complete. */
  animate?: boolean;
  /** Subtle tones for backgrounds; strong tones for small swatches that must read at a glance. */
  strength?: "subtle" | "strong";
  className?: string;
}

/**
 * The company's laying pattern drawn as SVG planks in brand tones (the signature element).
 * Planks are separated by a joint in the background color so the floor reads as material.
 */
export function FloorPattern({
  pattern,
  width = 1600,
  height = 1000,
  unit = 26,
  animate = false,
  strength = "subtle",
  className,
}: FloorPatternProps) {
  const layout = useMemo(() => layPattern(pattern, width, height, unit), [pattern, width, height, unit]);
  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid slice"
      className={cn("block", animate && "floor-pattern-animate", className)}
    >
      <g transform={`rotate(${layout.rotate} ${width / 2} ${height / 2})`}>
        {layout.planks.map((p, i) => (
          <rect
            key={i}
            x={p.x}
            y={p.y}
            width={p.width}
            height={p.height}
            fill={strength === "strong" ? STRONG_TONES[p.tone] : `var(--pattern-${p.tone})`}
            stroke="var(--background)"
            strokeWidth={1.5}
            style={animate ? { animationDelay: `${Math.round(p.order * LAY_SECONDS * 1000)}ms` } : undefined}
          />
        ))}
      </g>
    </svg>
  );
}
