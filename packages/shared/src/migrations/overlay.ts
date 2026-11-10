import type { DateShift } from "../date-shift";
import type { Company } from "../types";
import { upgradeCeiling } from "./permissions";

/**
 * The version of the saved demo data the code expects. Version 4 is feature batch 3, whose
 * fixtures change underneath the overlay (prices, units, suppliers, expenses, HR), so saved
 * changes from an older version cannot be upgraded and the company starts fresh
 * (docs/specs/feature-batch-03-plan.md, section 5).
 */
export const OVERLAY_SCHEMA_VERSION = 4;

/** Saved records of one collection, by id; null marks a deleted fixture record. */
export type StoredRecords = Record<string, unknown>;

/** One company's saved demo changes as the browser keeps them. */
export interface StoredOverlay {
  schemaVersion?: number;
  shift: DateShift;
  settings: unknown;
  records: Record<string, StoredRecords | undefined>;
}

/** Thrown when saved data cannot be used; the store then starts the company fresh. */
export class OverlayUpgradeError extends Error {}

/** Returns a saved overlay of the current version; anything else throws OverlayUpgradeError. */
export function upgradeOverlay(stored: StoredOverlay): StoredOverlay {
  if (stored.schemaVersion === OVERLAY_SCHEMA_VERSION) return stored;
  throw new OverlayUpgradeError(`Saved data version ${String(stored.schemaVersion)} cannot be upgraded.`);
}

/** The file ids a saved overlay refers to, so its uploads can go when it is dropped (plan section 5). */
export function overlayFileIds(stored: StoredOverlay): string[] {
  return Object.values(stored.records ?? {}).flatMap((records) =>
    Object.values(records ?? {}).flatMap((record) => {
      const files = (record as { files?: { id: string }[] } | null)?.files;
      return Array.isArray(files) ? files.map((f) => f.id) : [];
    }),
  );
}

/**
 * Upgrades a company record the super-admin changed in an older demo: its permission ceiling
 * gains the new keys, new modules the plan now includes are switched on, and its branches take
 * the fresh names.
 */
export function upgradeCompany(saved: Company, fresh: Company | undefined): Company {
  const modules = [...new Set([...saved.modules, ...(fresh?.modules ?? [])])];
  return {
    ...saved,
    modules,
    ceiling: upgradeCeiling(saved.ceiling, modules),
    branches: fresh?.branches ?? saved.branches,
  };
}
