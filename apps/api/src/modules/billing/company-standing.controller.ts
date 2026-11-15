import { Controller, Get, Header, UseGuards } from "@nestjs/common";
import { ApiCookieAuth, ApiTags } from "@nestjs/swagger";
import { companyStandingState, type CompanyStanding } from "@workspace/shared";
import { SessionOnly } from "../../core/tenancy/access";
import { isDatabaseUsable, isReadOnly, type CompanyAccess } from "../../core/tenancy/tenant-directory";
import { MemberCompany, StandingMemberGuard } from "./company-standing.guard";

/**
 * The company's standing from TenantGuard's own facts and predicates, in TenantGuard's order
 * (shared `companyStandingState`; spec part 4, "GET /company/standing", The answer). Only the state
 * leaves: no reason, date, plan or status word.
 */
function companyStandingOf(company: CompanyAccess): CompanyStanding {
  return {
    state: companyStandingState({
      maintenanceMode: company.maintenanceMode,
      databaseUsable: isDatabaseUsable(company.databaseStatus),
      readOnly: isReadOnly(company),
      phase: company.phase,
    }),
  };
}

/**
 * `GET /company/standing`: what the session's own company's next request meets, so the web shell
 * can show TenantGuard's refusals as one plain screen (docs/specs/platform-admin.md, part 4; ADR
 * 0054). It is the only session-only route outside /auth and /platform: TenantGuard would refuse a
 * company route in maintenance, with an unusable database or when locked, before any handler ran.
 * StandingMemberGuard, at class level, checks membership on control rows only, so a handler added
 * here later inherits it. Every member gets the same answer. Not audited (a read) and not behind
 * `settings.billing`, like `GET /auth/context`.
 */
@ApiTags("company")
@ApiCookieAuth()
@Controller("company/standing")
@SessionOnly()
@UseGuards(StandingMemberGuard)
export class CompanyStandingController {
  /** GET /company/standing: `{ state }`, never cached. */
  @Get()
  @Header("Cache-Control", "no-store")
  read(@MemberCompany() company: CompanyAccess): CompanyStanding {
    return companyStandingOf(company);
  }
}
