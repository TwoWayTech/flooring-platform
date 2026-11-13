import { ServiceUnavailableException } from "@nestjs/common";

/**
 * 503 `company_maintenance`: the company is under maintenance, a move between providers or a
 * failed migration, so nothing may be read or written (owner decision, 2026-11-13).
 */
export function companyMaintenance(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: "company_maintenance",
    message: "Your company's account is under maintenance. Please try again later; your data is safe.",
  });
}

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
