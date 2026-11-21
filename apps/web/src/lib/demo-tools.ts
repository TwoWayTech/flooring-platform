import { featureOn, type FeatureKey } from "@workspace/shared";
import { isDemoMode } from "./data-source";

/**
 * Features that only make sense in the demo build: the presenter guide, its network simulation and
 * Reset demo data. The real product (api mode) never shows them, whatever their switch says
 * (click-through #69).
 */
export const DEMO_TOOLS: ReadonlySet<FeatureKey> = new Set<FeatureKey>([
  "shell.presenter-guide",
  "shell.network-simulation",
  "demo.reset",
]);

/** Whether a feature shows in this build: switched on, and for a demo tool, only in the demo. */
export function featureInBuild(key: FeatureKey): boolean {
  return featureOn(key) && (!DEMO_TOOLS.has(key) || isDemoMode());
}
