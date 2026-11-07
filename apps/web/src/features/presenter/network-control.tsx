"use client";

import { cn } from "@workspace/ui/lib/utils";
import { setNetworkMode, useNetworkMode, type NetworkMode } from "@/lib/api/network";

const MODES: [NetworkMode, string][] = [
  ["normal", "Normal"],
  ["slow", "Slow"],
  ["offline", "Offline"],
];

/**
 * Lets the presenter slow the network down or take it offline, to show loading and error states
 * on the next screen opened or the next save (spec Tier 3). It resets to normal on reload.
 */
export function NetworkControl() {
  const network = useNetworkMode();
  return (
    <div className="flex items-center gap-2">
      <span id="network-label" className="text-muted-foreground text-xs">
        Network
      </span>
      <div role="group" aria-labelledby="network-label" className="bg-raised ml-auto flex rounded-md p-0.5">
        {MODES.map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            aria-pressed={network === mode}
            onClick={() => setNetworkMode(mode)}
            className={cn(
              "h-7 rounded-sm px-2.5 text-xs",
              network === mode
                ? "bg-surface text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
