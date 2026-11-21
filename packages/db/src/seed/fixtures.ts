import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { Company, CompanyFixtures, PlatformFixtures } from "@workspace/shared";
import { v5 as uuidv5 } from "uuid";

const require = createRequire(import.meta.url);

/** Fixed namespace for seed ids; changing it would duplicate every seeded row. */
const SEED_NAMESPACE = "6f1c2b0e-8a57-4c1e-9d3b-2f4a7e5c9b10";

/**
 * A stable id for a seeded record, made from its demo fixture id. Seeding twice gives the same
 * ids, so every insert can skip rows that exist. These are UUID v5, not v7: a seed needs ids it
 * can recompute, and the table rule asks for UUIDs that sort by time only for live records.
 */
export function seedId(key: string): string {
  return uuidv5(key, SEED_NAMESPACE);
}

function readFixture<T>(name: string): T {
  return JSON.parse(readFileSync(require.resolve(`@workspace/shared/fixtures/${name}.json`), "utf8")) as T;
}

/** One demo company's platform record and fixtures, read from packages/shared/fixtures (fixed seed). */
export interface DemoCompany {
  company: Company;
  fixtures: CompanyFixtures;
}

/** Loads a demo company by id: Summit Floor Co. for every seed, Harbor Staffing Co. for the local-only one (ADR 0065). */
export function loadDemoCompany(id: Company["id"]): DemoCompany {
  const platform = readFixture<PlatformFixtures>("platform");
  const company = platform.companies.find((candidate) => candidate.id === id);
  if (!company) throw new Error(`No demo company "${id}".`);
  return { company, fixtures: readFixture<CompanyFixtures>(id) };
}
