import type { CompanyId, PlatformFixtures, ProductKey } from "@workspace/shared";
import platform from "@workspace/shared/fixtures/platform.json";

/** The product each demo company subscribes to, for checking a sign-in against the host. */
export function companyProduct(companyId: CompanyId): ProductKey | undefined {
  return (platform as PlatformFixtures).companies.find((c) => c.id === companyId)?.product;
}
