"use client";

import { format, parseISO } from "date-fns";
import { useCallback, useContext } from "react";
import { WorkspaceContext } from "@/components/workspace/workspace-context";

/** Dates outside a company, such as on the platform console, which belongs to no company's format. */
const PLATFORM_DATE_FORMAT = "MMM d, yyyy";

/**
 * Formats ISO dates in the company's date format (Settings: Localization, Region). With
 * `withTime`, date-times also show the time, e.g. "Nov 7, 2026, 10:15 AM". Outside a company
 * workspace (the platform console's tables and their filter chips) it uses "MMM d, yyyy".
 */
export function useFormatDate() {
  const workspace = useContext(WorkspaceContext);
  const pattern = workspace?.settings.localization.region.dateFormat ?? PLATFORM_DATE_FORMAT;
  return useCallback(
    (iso: string, withTime = false) =>
      format(parseISO(iso), withTime && iso.length > 10 ? `${pattern}, h:mm a` : pattern),
    [pattern],
  );
}
