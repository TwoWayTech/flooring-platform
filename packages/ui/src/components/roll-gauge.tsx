"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useId, useRef } from "react";
import { useElementWidth } from "@workspace/ui/hooks/use-element-width";
import { cn } from "@workspace/ui/lib/utils";

interface RollGaugeProps {
  originalFt: number;
  remainingFt: number;
  /** Lengths of the cuts in the order they were taken; each leaves a notch on the scale. */
  cutsFt: readonly number[];
  size?: "mini" | "large";
  className?: string;
  /** Accessible summary, e.g. "63 ft of 150 ft left". */
  label: string;
}

const LAYOUT = {
  mini: { width: 96, height: 16, track: 6, maxR: 7, coreR: 2.5, gap: 4 },
  large: { width: 640, height: 112, track: 26, maxR: 44, coreR: 12, gap: 20 },
  narrow: { width: 340, height: 92, track: 20, maxR: 30, coreR: 9, gap: 12 },
};

/** Below this width the large gauge uses the narrow layout and labels every 50 ft. */
const NARROW_BELOW_PX = 520;

/**
 * Side view of a carpet roll (design brief "The signature element"): the roll end, whose area
 * shrinks with the length left, and a track the length of the original roll. Oak shows what is
 * left, a dashed outline shows what was cut, and a notch marks the end of every cut. A cut
 * animates, because the motion shows what changed.
 */
export function RollGauge({ originalFt, remainingFt, cutsFt, size = "large", className, label }: RollGaugeProps) {
  const reduced = useReducedMotion();
  const hatchId = useId();
  const { ref, width: measured } = useElementWidth<HTMLDivElement>(LAYOUT.large.width);
  const large = size === "large";
  const narrow = large && measured < NARROW_BELOW_PX;
  const l = { ...LAYOUT[narrow ? "narrow" : size], ...(large ? { width: measured } : {}) };
  const tickFt = narrow ? 50 : 25;
  const cy = l.height / 2 - (large ? 8 : 0);
  const share = originalFt > 0 ? Math.max(0, Math.min(1, remainingFt / originalFt)) : 0;
  // Cross-section area is proportional to the length still wound, so the radius follows √share.
  const radius = l.coreR + (l.maxR - l.coreR) * Math.sqrt(share);
  const x0 = l.maxR * 2 + l.gap;
  const trackWidth = Math.max(1, l.width - x0 - 1);
  const scale = trackWidth / Math.max(originalFt, 1);
  // Only a change in length (a cut) animates; resizing or first paint draws instantly.
  const lastRemaining = useRef(remainingFt);
  const cutHappened = lastRemaining.current !== remainingFt;
  useEffect(() => {
    lastRemaining.current = remainingFt;
  }, [remainingFt]);
  const transition =
    reduced || !cutHappened ? { duration: 0 } : { type: "spring" as const, stiffness: 140, damping: 22 };
  let usedFt = 0;
  const notches = cutsFt.map((cut) => {
    usedFt += cut;
    return x0 + (originalFt - usedFt) * scale;
  });
  const rings = large ? Math.max(1, Math.round((radius - l.coreR) / 5)) : 0;
  const ticks = large ? Array.from({ length: Math.floor(originalFt / tickFt) + 1 }, (_, i) => i * tickFt) : [];
  const bar = { x: x0, y: cy - l.track / 2, height: l.track, rx: large ? 2 : 1 };

  return (
    <div ref={ref} className={cn("w-full", className)}>
      <svg role="img" aria-label={label} viewBox={`0 0 ${l.width} ${l.height}`} className="block w-full">
        <defs>
          <pattern id={hatchId} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="4" stroke="var(--background)" strokeOpacity="0.35" strokeWidth="1" />
          </pattern>
        </defs>
        <rect
          {...bar}
          width={trackWidth}
          fill="none"
          stroke="var(--hairline)"
          strokeDasharray={large ? "4 3" : undefined}
        />
        <motion.rect
          {...bar}
          fill="var(--oak)"
          initial={false}
          animate={{ width: remainingFt * scale }}
          transition={transition}
        />
        <motion.rect
          {...bar}
          fill={`url(#${hatchId})`}
          initial={false}
          animate={{ width: remainingFt * scale }}
          transition={transition}
        />
        {notches.map((x, i) => (
          <line
            key={i}
            x1={x}
            x2={x}
            y1={bar.y - (large ? 6 : 2)}
            y2={bar.y + l.track + (large ? 6 : 2)}
            stroke="var(--foreground)"
            strokeOpacity="0.55"
            strokeWidth={large ? 1.5 : 1}
          />
        ))}
        <motion.circle
          cx={l.maxR}
          cy={cy}
          fill="var(--oak)"
          initial={false}
          animate={{ r: radius }}
          transition={transition}
        />
        {Array.from({ length: rings }, (_, i) => (
          <motion.circle
            key={i}
            cx={l.maxR}
            cy={cy}
            fill="none"
            stroke="var(--background)"
            strokeOpacity="0.4"
            initial={false}
            animate={{ r: l.coreR + ((radius - l.coreR) * (i + 1)) / (rings + 1) }}
            transition={transition}
          />
        ))}
        <circle cx={l.maxR} cy={cy} r={l.coreR} fill="var(--surface)" stroke="var(--hairline)" />
        {ticks.map((ft) => (
          <text
            key={ft}
            x={x0 + ft * scale}
            y={l.height - 2}
            textAnchor={ft === 0 ? "start" : x0 + ft * scale > l.width - 24 ? "end" : "middle"}
            className="fill-muted-foreground text-[11px] tabular-nums"
          >
            {ft} ft
          </text>
        ))}
      </svg>
    </div>
  );
}
