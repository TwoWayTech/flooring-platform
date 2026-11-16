import { tenantModuleOverrides } from "@workspace/db/control";
import { FEATURES, type FeatureKey, type ModuleKey } from "@workspace/shared";
import { and, eq } from "drizzle-orm";
import type { AuthHarness } from "../auth-harness";

/**
 * Runs `run` with one module switched off for one company, as a platform admin's override does
 * (`tenant_module_overrides`; blueprint "Four layers of control", layer 2), and removes the override
 * afterwards whatever happens. AccessService reads overrides on every request, so it applies at once.
 */
export async function withModuleOff(
  harness: AuthHarness,
  companyId: string,
  module: ModuleKey,
  run: () => Promise<void>,
): Promise<void> {
  await harness.control.db.insert(tenantModuleOverrides).values({ tenantId: companyId, module, enabled: false });
  try {
    await run();
  } finally {
    await harness.control.db
      .delete(tenantModuleOverrides)
      .where(and(eq(tenantModuleOverrides.tenantId, companyId), eq(tenantModuleOverrides.module, module)));
  }
}

/**
 * Runs `run` with these features switched off in this process (CLAUDE.md rule 13: a switched-off
 * feature is hidden everywhere, the API included), and restores each switch as it was afterwards.
 */
export async function withFeaturesOff<T>(keys: readonly FeatureKey[], run: () => Promise<T>): Promise<T> {
  const features = keys.map((key) => FEATURES[key] as { enabled: boolean });
  const before = features.map((feature) => feature.enabled);
  for (const feature of features) feature.enabled = false;
  try {
    return await run();
  } finally {
    features.forEach((feature, index) => {
      feature.enabled = before[index];
    });
  }
}
