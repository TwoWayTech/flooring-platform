import { ServiceUnavailableException } from "@nestjs/common";

/**
 * 503 `company_unavailable`: the company's database cannot serve requests right now (provisioning,
 * migrating, failed or missing). TenantGuard and TenantConnectionService both answer with it.
 */
export function companyUnavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: "company_unavailable",
    message: "Your company's data is not available right now. Please try again in a few minutes.",
  });
}
