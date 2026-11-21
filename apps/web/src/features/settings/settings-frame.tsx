"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { cn } from "@workspace/ui/lib/utils";
import { SettingsNav, type NavWidth } from "./settings-nav";

/**
 * Pages that need the whole width below 1400 px: Security roles' permission grid has a column per
 * action, which beside the settings menu at 1280 px scrolled sideways (click-through #53).
 */
const WIDE_PAGES: readonly string[] = ["/settings/roles"];

/** Whether a settings page gets the menu as a row above it until 1400 px. */
export function isWideSettingsPage(pathname: string): boolean {
  return WIDE_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
}

/**
 * The settings navigation beside the page from `lg` up, or for a wide page, as a scrolling row above
 * it until 1400 px, so the page has the full width at 1280 px.
 */
export function SettingsFrame({ children }: { children: ReactNode }) {
  const width: NavWidth = isWideSettingsPage(usePathname()) ? "wide" : "normal";
  return (
    <div
      className={cn(
        "grid grid-cols-1 items-start gap-6",
        width === "wide" ? "min-[1400px]:grid-cols-[200px_minmax(0,1fr)]" : "lg:grid-cols-[200px_minmax(0,1fr)]",
      )}
    >
      <SettingsNav width={width} />
      <div className="flex min-w-0 flex-col gap-6">{children}</div>
    </div>
  );
}
