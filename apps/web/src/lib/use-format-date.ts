"use client";

import { useCallback, useContext } from "react";
import { WorkspaceContext } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { browserZone, formatWhen } from "@/lib/moments";

/** Dates outside a company, such as on the platform console, which belongs to no company's format. */
const PLATFORM_DATE_FORMAT = "MMM d, yyyy";

/**
 * The zone this screen shows moments in (ADR 0064): the open company's, the one `today()` reads;
 * the browser's outside a company workspace (the platform console), named like any other zone.
 */
export function useTimeZone(): string {
  const workspace = useContext(WorkspaceContext);
  return (workspace ? api.timeZone() : null) ?? browserZone();
}

/**
 * Formats ISO dates in the company's date format (Settings: Localization, Region), and moments on
 * the company's clock (ADR 0064). With `withTime`, a moment also shows its 12-hour time and names the
 * zone, e.g. "Nov 21, 2026, 7:56 AM MST"; a calendar date is never shifted. Outside a company
 * workspace (every platform console page: its tables, filter chips, company facts and data import)
 * it uses "MMM d, yyyy" and the browser's zone, so the console has one date format.
 */
export function useFormatDate() {
  const workspace = useContext(WorkspaceContext);
  const pattern = workspace?.settings.localization.region.dateFormat ?? PLATFORM_DATE_FORMAT;
  const zone = useTimeZone();
  return useCallback((iso: string, withTime = false) => formatWhen(iso, { pattern, zone, withTime }), [pattern, zone]);
}
