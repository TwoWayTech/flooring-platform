import type { DateShift } from "../date-shift";
import type { Company, CompanyFixtures } from "../types";
import { upgradeCeiling, upgradeRole } from "./permissions";
import { mergeDefaults } from "./merge";
import { V2_RECORD_STEPS } from "./records";

/**
 * The version of the saved demo data the code expects (docs/specs/feature-batch-02-plan.md,
 * section 2.3). Version 1 data had no version field.
 */
export const OVERLAY_SCHEMA_VERSION = 2;

/** Saved records of one collection, by id; null marks a deleted fixture record. */
export type StoredRecords = Record<string, unknown>;

/** One company's saved demo changes as the browser keeps them. */
export interface StoredOverlay {
  schemaVersion?: number;
  shift: DateShift;
  settings: unknown;
  records: Record<string, StoredRecords | undefined>;
}

/** Thrown when saved data cannot be upgraded; the store then starts the company fresh. */
export class OverlayUpgradeError extends Error {}

/** What an upgrade step may read: the fresh fixtures of the same company. */
export interface UpgradeContext {
  base: CompanyFixtures;
}

/** Upgrades the saved records of one collection; returns the collections to write. */
export type RecordStep = (records: StoredOverlay["records"], ctx: UpgradeContext) => StoredOverlay["records"];

function upgradeRoles(records: StoredOverlay["records"], ctx: UpgradeContext): StoredOverlay["records"] {
  const roles = records.roles;
  if (!roles) return records;
  const upgraded = Object.fromEntries(
    Object.entries(roles).map(([id, role]) => [
      id,
      role === null ? null : upgradeRole(role as Parameters<typeof upgradeRole>[0], ctx.base.roles),
    ]),
  );
  return { ...records, roles: upgraded };
}

/**
 * Brings a company's saved changes up to the current schema. Version 1 changes are upgraded
 * step by step; anything unexpected throws OverlayUpgradeError, so a half-upgraded overlay is
 * never used.
 */
export function upgradeOverlay(stored: StoredOverlay, ctx: UpgradeContext): StoredOverlay {
  if (stored.schemaVersion === OVERLAY_SCHEMA_VERSION) return stored;
  if (stored.schemaVersion !== undefined && stored.schemaVersion !== 1) {
    throw new OverlayUpgradeError(`Unknown saved data version ${String(stored.schemaVersion)}.`);
  }
  try {
    const steps: RecordStep[] = [upgradeRoles, ...V2_RECORD_STEPS];
    const records = steps.reduce((acc, step) => step(acc, ctx), stored.records ?? {});
    const settings = stored.settings ? mergeDefaults(ctx.base.settings, stored.settings) : null;
    return { schemaVersion: OVERLAY_SCHEMA_VERSION, shift: stored.shift, settings, records };
  } catch (error) {
    if (error instanceof OverlayUpgradeError) throw error;
    throw new OverlayUpgradeError(error instanceof Error ? error.message : "Saved data could not be read.");
  }
}

/** Upgrades a company record the super-admin changed in an older demo (its permission ceiling). */
export function upgradeCompany(company: Company): Company {
  return { ...company, ceiling: upgradeCeiling(company.ceiling, company.modules) };
}
