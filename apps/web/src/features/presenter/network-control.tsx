"use client";

import { Segmented } from "@workspace/ui/components/segmented";
import { setNetworkMode, useNetworkMode, type NetworkMode } from "@/lib/api/network";

const MODES = [
  ["normal", "Normal"],
  ["slow", "Slow"],
  ["offline", "Offline"],
] as const satisfies readonly (readonly [NetworkMode, string])[];

/**
 * Lets the presenter slow the network down or take it offline, to show loading and error states
 * on the next screen opened or the next save (spec Tier 3). It resets to normal on reload.
 */
export function NetworkControl() {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground text-xs">Network</span>
      <Segmented label="Network" size="sm" options={MODES} value={useNetworkMode()} onChange={setNetworkMode} />
    </div>
  );
}
