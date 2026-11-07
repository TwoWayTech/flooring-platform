"use client";

import { format, parseISO } from "date-fns";
import { useCallback } from "react";
import { useWorkspace } from "@/components/workspace/workspace-context";

/**
 * Formats ISO dates in the company's date format (Settings: Localization, Region). With
 * `withTime`, date-times also show the time, e.g. "Nov 7, 2026, 10:15 AM".
 */
export function useFormatDate() {
  const { settings } = useWorkspace();
  const pattern = settings.localization.region.dateFormat;
  return useCallback(
    (iso: string, withTime = false) =>
      format(parseISO(iso), withTime && iso.length > 10 ? `${pattern}, h:mm a` : pattern),
    [pattern],
  );
}
