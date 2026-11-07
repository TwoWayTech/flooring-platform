"use client";

import type { CSSProperties } from "react";
import { useTheme } from "next-themes";
import { LayoutDashboard, Layers, Receipt } from "lucide-react";
import { brandTokens, type Branding } from "@workspace/shared";
import { FloorPattern } from "@workspace/ui/components/floor-pattern";
import { Monogram } from "@workspace/ui/components/monogram";

/** CSS variables for one brand color in the current theme, scoped to the preview only. */
function previewVars(color: string, dark: boolean): CSSProperties {
  const t = brandTokens(color)[dark ? "dark" : "light"];
  return {
    ["--brand" as string]: t.accent,
    ["--brand-foreground" as string]: t.accentForeground,
    ["--brand-ink" as string]: t.accentInk,
    ["--brand-soft" as string]: t.accentSoft,
    ["--pattern-1" as string]: t.pattern[0],
    ["--pattern-2" as string]: t.pattern[1],
    ["--pattern-3" as string]: t.pattern[2],
  };
}

/**
 * A small piece of the app in the draft branding (spec "Settings: Branding": live preview):
 * the sidebar header, an active menu item, a primary button, and the pattern behind them.
 */
export function BrandPreview({ branding }: { branding: Branding }) {
  const { resolvedTheme } = useTheme();
  return (
    <div
      style={previewVars(branding.brandColor, resolvedTheme === "dark")}
      className="border-hairline rounded-panel relative overflow-hidden border"
    >
      <FloorPattern
        pattern={branding.pattern}
        width={640}
        height={300}
        unit={18}
        className="absolute inset-0 size-full"
      />
      <div className="relative m-5 flex flex-col gap-4 sm:flex-row">
        <div className="bg-background rounded-panel flex w-full flex-col gap-1 p-3 sm:w-52">
          <div className="mb-2 flex items-center gap-2.5">
            <span className="relative size-9 shrink-0">
              <FloorPattern
                pattern={branding.pattern}
                width={72}
                height={72}
                unit={7}
                strength="strong"
                className="rounded-panel size-full overflow-hidden"
              />
            </span>
            <Monogram
              letters={branding.monogram}
              logoUrl={branding.logoDataUrl}
              name={branding.displayName}
              className="size-7 text-[10px]"
            />
            <span className="truncate text-sm font-semibold">{branding.displayName}</span>
          </div>
          <span className="bg-brand-soft text-brand-ink flex h-8 items-center gap-2 rounded-md px-2 text-sm font-medium">
            <LayoutDashboard aria-hidden="true" className="size-4" />
            Dashboard
          </span>
          <span className="flex h-8 items-center gap-2 px-2 text-sm">
            <Receipt aria-hidden="true" className="text-muted-foreground size-4" />
            Sales
          </span>
          <span className="flex h-8 items-center gap-2 px-2 text-sm">
            <Layers aria-hidden="true" className="text-muted-foreground size-4" />
            Inventory
          </span>
        </div>
        <div className="bg-surface rounded-panel flex flex-1 flex-col items-start justify-center gap-3 p-4">
          <p className="font-display text-lg font-semibold">Quote Q-2301</p>
          <p className="text-brand-ink text-sm font-medium">Link color on panels</p>
          <span className="bg-brand text-brand-foreground inline-flex h-8 items-center rounded-md px-3 text-sm font-medium">
            Convert to invoice
          </span>
        </div>
      </div>
    </div>
  );
}
