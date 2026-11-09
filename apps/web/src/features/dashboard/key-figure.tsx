"use client";

import Link from "next/link";
import { animate } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { formatNumber, type NumberKind } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { useNumberSettings } from "@workspace/ui/components/number-settings";

const COUNTED_KEY = "fp-figures-counted";

/** Whether to count up: once per session (design brief) and never with reduced motion. */
function shouldCount(): boolean {
  try {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    return !reduced && sessionStorage.getItem(COUNTED_KEY) !== "1";
  } catch {
    return false;
  }
}

/**
 * Counts from zero to the value once per session, then hands over to <Num> so hover shows the
 * full value. With reduced motion, or after the first time, the value simply appears.
 */
function CountUp({ value, kind, compact }: { value: string; kind: NumberKind; compact: boolean }) {
  const settings = useNumberSettings();
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  const ref = useRef<HTMLSpanElement>(null);
  const [counting, setCounting] = useState(shouldCount);

  useEffect(() => {
    if (!counting) return;
    const target = Number(value);
    const controls = animate(0, target, {
      duration: 0.9,
      ease: [0.2, 0.7, 0.2, 1],
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = formatNumber(String(v), kind, settingsRef.current, { compact });
      },
      onComplete: () => {
        try {
          sessionStorage.setItem(COUNTED_KEY, "1");
        } catch {
          // The figures will count again next load; harmless.
        }
        setCounting(false);
      },
    });
    return () => controls.stop();
  }, [counting, value, kind, compact]);

  if (!counting) return <Num value={value} kind={kind} compact={compact} />;
  return <span ref={ref} className="tabular-nums" aria-hidden="true" />;
}

interface KeyFigureProps {
  label: string;
  value: string;
  kind: NumberKind;
  note?: string;
  /** Makes the label a link to the list behind the figure. */
  href?: string;
}

/** One key figure in the revenue panel's row: a small label over a figure in Unbounded. */
export function KeyFigure({ label, value, kind, note, href }: KeyFigureProps) {
  const { compactDashboards } = useNumberSettings();
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-muted-foreground text-xs">
        {href ? (
          <Link href={href} className="text-brand-ink underline-offset-4 hover:underline">
            {label}
          </Link>
        ) : (
          label
        )}
      </dt>
      <dd className="font-display text-xl font-semibold tracking-[-0.01em] sm:text-2xl">
        <CountUp value={value} kind={kind} compact={compactDashboards && kind === "money"} />
      </dd>
      {note ? <dd className="text-muted-foreground text-xs">{note}</dd> : null}
    </div>
  );
}
