import type { CompanyFixtures, CompanyId, PlatformFixtures } from "@workspace/shared";

/**
 * Loads generated fixtures on demand, one company per chunk, so the browser only downloads the
 * company being shown. This is the only module that imports fixtures (CLAUDE.md rule 1).
 */
const COMPANY_LOADERS: Record<CompanyId, () => Promise<{ default: unknown }>> = {
  summit: () => import("@workspace/shared/fixtures/summit.json"),
  keystone: () => import("@workspace/shared/fixtures/keystone.json"),
  harbor: () => import("@workspace/shared/fixtures/harbor.json"),
};

/** One company's generated fixtures. */
export async function loadCompanyFixtures(companyId: CompanyId): Promise<CompanyFixtures> {
  return (await COMPANY_LOADERS[companyId]()).default as CompanyFixtures;
}

/** The platform fixtures: companies with their modules, ceilings and limits. */
export async function loadPlatformFixtures(): Promise<PlatformFixtures> {
  return (await import("@workspace/shared/fixtures/platform.json")).default as PlatformFixtures;
}
