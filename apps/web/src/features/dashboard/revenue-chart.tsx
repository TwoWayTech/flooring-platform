"use client";

import { useReducedMotion } from "motion/react";
import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis, type TooltipContentProps } from "recharts";
import { formatNumber, type PnlMonth } from "@workspace/shared";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@workspace/ui/components/chart";
import { Num } from "@workspace/ui/components/num";
import { useNumberSettings } from "@workspace/ui/components/number-settings";

/** Brand first, Oak second (design brief "Charts"); both validated with the dataviz checks. */
const CONFIG = {
  revenue: { label: "Revenue", color: "var(--chart-1)" },
  grossMargin: { label: "Gross margin", color: "var(--chart-2)" },
} satisfies ChartConfig;

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-03" as "Mar". */
export function monthLabel(month: string): string {
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? month;
}

function Tip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload as PnlMonth;
  return (
    <div className="bg-surface border-hairline rounded-panel min-w-44 border px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-semibold">{label}</p>
      {payload.map((p) => (
        <p key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-xs" style={{ background: p.color }} />
            {CONFIG[p.dataKey as keyof typeof CONFIG].label}
          </span>
          <Num kind="money" value={row[p.dataKey as "revenue" | "grossMargin"]} />
        </p>
      ))}
    </div>
  );
}

/** Text label at the right end of a series, so identity never relies on color (dataviz rules). */
function endLabel(name: string, last: number) {
  function EndLabel(props: { index?: number; x?: number | string; y?: number | string }) {
    if (props.index !== last) return null;
    return (
      <text x={Number(props.x) - 4} y={Number(props.y) - 10} textAnchor="end" className="fill-foreground text-[11px]">
        {name}
      </text>
    );
  }
  return EndLabel;
}

/**
 * Revenue as an area and gross margin as a line on one dollar axis (spec "Dashboard"). The
 * margin line only renders for viewers who may see margins.
 */
export function RevenueChart({ months, showMargin }: { months: PnlMonth[]; showMargin: boolean }) {
  const settings = useNumberSettings();
  const reduced = useReducedMotion();
  const data = months.map((m) => ({
    ...m,
    revenue: Number(m.revenue),
    grossMargin: Number(m.grossMargin),
    label: monthLabel(m.month),
  }));
  const last = data.length - 1;
  return (
    <ChartContainer config={CONFIG} className="aspect-auto h-64 w-full sm:h-72">
      <ComposedChart data={data} margin={{ top: 20, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} stroke="var(--hairline)" strokeOpacity={0.6} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={56}
          tickFormatter={(v: number) => formatNumber(String(v), "money", settings, { compact: true })}
        />
        <ChartTooltip cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} content={<Tip />} />
        <Area
          dataKey="revenue"
          type="monotone"
          stroke="var(--color-revenue)"
          strokeWidth={2}
          fill="var(--color-revenue)"
          fillOpacity={0.14}
          isAnimationActive={!reduced}
          animationDuration={900}
          label={endLabel("Revenue", last)}
        />
        {showMargin ? (
          <Line
            dataKey="grossMargin"
            type="monotone"
            stroke="var(--color-grossMargin)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }}
            isAnimationActive={!reduced}
            animationDuration={900}
            label={endLabel("Gross margin", last)}
          />
        ) : null}
      </ComposedChart>
    </ChartContainer>
  );
}
