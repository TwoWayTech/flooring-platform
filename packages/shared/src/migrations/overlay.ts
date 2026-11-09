import type { DateShift } from "../date-shift";
import type { Company, CompanyFixtures } from "../types";
import { upgradeCeiling, upgradeRole } from "./permissions";
import { mergeDefaults } from "./merge";
import { V2_RECORD_STEPS } from "./records";
import { V3_RECORD_STEPS } from "./records-v3";

/**
 * The version of the saved demo data the code expects (docs/specs/feature-batch-02-plan.md,
 * section 2.3). Version 1 data had no version field; version 2 is Batch A, version 3 Batch B.
 */
export const OVERLAY_SCHEMA_VERSION = 3;

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

/** The record steps that lead to each schema version, run in order from the saved version up. */
const STEPS_TO: Readonly<Record<number, readonly RecordStep[]>> = {
  2: [upgradeRoles, ...V2_RECORD_STEPS],
  3: V3_RECORD_STEPS,
};

/**
 * Brings a company's saved changes up to the current schema, one version at a time, and fills
 * settings with fields added since. Anything unexpected throws OverlayUpgradeError, so a
 * half-upgraded overlay is never used.
 */
export function upgradeOverlay(stored: StoredOverlay, ctx: UpgradeContext): StoredOverlay {
  if (stored.schemaVersion === OVERLAY_SCHEMA_VERSION) return stored;
  const from = stored.schemaVersion ?? 1;
  if (!Number.isInteger(from) || from < 1 || from > OVERLAY_SCHEMA_VERSION) {
    throw new OverlayUpgradeError(`Unknown saved data version ${String(stored.schemaVersion)}.`);
  }
  try {
    const steps: RecordStep[] = [];
    for (let version = from + 1; version <= OVERLAY_SCHEMA_VERSION; version++) steps.push(...(STEPS_TO[version] ?? []));
    const records = steps.reduce((acc, step) => step(acc, ctx), stored.records ?? {});
    const settings = stored.settings ? mergeDefaults(ctx.base.settings, stored.settings) : null;
    return { schemaVersion: OVERLAY_SCHEMA_VERSION, shift: stored.shift, settings, records };
  } catch (error) {
    if (error instanceof OverlayUpgradeError) throw error;
    throw new OverlayUpgradeError(error instanceof Error ? error.message : "Saved data could not be read.");
  }
}

/**
 * Upgrades a company record the super-admin changed in an older demo: its permission ceiling
 * gains the new keys, and its branches take the fresh names (plan K-4).
 */
export function upgradeCompany(saved: Company, fresh: Company | undefined): Company {
  return {
    ...saved,
    ceiling: upgradeCeiling(saved.ceiling, saved.modules),
    branches: fresh?.branches ?? saved.branches,
  };
}
