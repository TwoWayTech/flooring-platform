"use client";

import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { formatNumber, type NumberKind } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { useNumberSettings } from "@workspace/ui/components/number-settings";

/** SVG coordinates to two decimals; geometry, not a number people read. */
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * A sparkline: one series in the first chart colour, a 2 px line, no axes. It is decorative; the
 * card says the value and the change in words (dataviz: a single series needs no legend).
 */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const d = points
    .map((p, i) => `${round((i / (points.length - 1)) * 100)},${round(30 - ((p - min) / span) * 26 - 2)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="text-chart-1 h-8 w-full" aria-hidden="true">
      <polyline
        points={d}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface FigureCardProps {
  label: string;
  value: string;
  kind: NumberKind;
  /** Percent change vs the previous period of the same length; null when there is none. */
  change?: string | null;
  /** For costs and overdue amounts, going up is bad. */
  upIsBad?: boolean;
  note?: string;
  points?: number[];
  href?: string;
}

/**
 * One key figure card (spec E1): label, the value in compact tabular numerals, the change vs the
 * previous period with an arrow and a word (never colour alone), and a small sparkline.
 */
export function FigureCard({ label, value, kind, change, upIsBad, note, points, href }: FigureCardProps) {
  const numbers = useNumberSettings();
  const up = change !== null && change !== undefined && Number(change) > 0;
  const down = change !== null && change !== undefined && Number(change) < 0;
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : Minus;
  const good = (up && !upIsBad) || (down && upIsBad);
  return (
    <div className="bg-surface border-hairline rounded-panel flex min-w-0 flex-col gap-1 border p-4">
      <dt className="text-muted-foreground text-xs">
        {href ? (
          <Link href={href} className="text-brand-ink underline-offset-4 hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
      </dt>
      <dd className="font-display truncate text-xl font-semibold tabular-nums sm:text-2xl">
        <Num value={value} kind={kind} compact={kind === "money"} />
      </dd>
      {change !== undefined ? (
        <dd
          className={`flex items-center gap-1 text-xs ${change === null ? "text-muted-foreground" : good ? "text-success-ink" : "text-danger-ink"}`}
        >
          <Icon aria-hidden="true" className="size-3.5" />
          {change === null
            ? "No earlier period to compare"
            : `${up ? "Up" : down ? "Down" : "Level"} ${formatNumber(String(Math.abs(Number(change))), "percent", numbers)} vs previous period`}
        </dd>
      ) : null}
      {note ? <dd className="text-muted-foreground text-xs">{note}</dd> : null}
      {points ? (
        <dd>
          <Sparkline points={points} />
        </dd>
      ) : null}
    </div>
  );
}
