"use client";

import { useStoredFlag } from "@/lib/use-stored-flag";
import { featureInBuild } from "@/lib/demo-tools";

/** Width of the floating guide plus its gap to the window edge, so toasts can sit beside it. */
export const GUIDE_FOOTPRINT_PX = 360;

/** Whether the presenter guide is open in this browser, shared by the top bar, palette and panel. */
export function usePresenterGuide(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useStoredFlag("fp-presenter-guide");
  return [open && featureInBuild("shell.presenter-guide"), setOpen];
}
