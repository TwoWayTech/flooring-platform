import { BadRequestException, Controller, Get, Inject, NotFoundException, Query } from "@nestjs/common";
import { ApiBadRequestResponse, ApiNotFoundResponse, ApiOkResponse, ApiProperty, ApiQuery, ApiTags } from "@nestjs/swagger";
import type { ControlDb, DbHandle } from "@workspace/db";
import { CompanyDirectory } from "../auth/company-directory";
import { hostCompanySlug } from "../auth/company-pick";
import { CONTROL_DB } from "../database/control-db";
import { brandingQuerySchema, publicBrandingOf, type PublicBranding } from "./public-branding";

/** A company's branding for its login page. */
export class PublicBrandingView implements PublicBranding {
  @ApiProperty({ example: "Summit Floor Co." })
  displayName: string;

  @ApiProperty({ example: "SF" })
  monogram: string;

  @ApiProperty({ example: "#1F5C99", description: "6-digit hex." })
  brandColor: string;

  @ApiProperty({ example: "herringbone" })
  pattern: string;

  @ApiProperty({ enum: ["light", "dark", "system"] })
  defaultTheme: "light" | "dark" | "system";
}

const NOT_FOUND = "No company uses this address.";

/**
 * GET /public/branding?host=: the company's name, colour and pattern for its login page, before
 * anyone signs in (blueprint p16, docs/real-build-plan.md week 2). Public on purpose, so it returns
 * display fields only. The logo arrives with the branding upload (P11).
 */
@ApiTags("public")
@Controller("public")
export class BrandingController {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly companies: CompanyDirectory,
  ) {}

  /** 200 with the branding, 404 when the host names no live company, 400 when it is not a host. */
  @Get("branding")
  @ApiQuery({ name: "host", example: "summit.flooringsuite.com" })
  @ApiOkResponse({ type: PublicBrandingView })
  @ApiNotFoundResponse({ description: "The host names no company, or the company is deleted or has no branding." })
  @ApiBadRequestResponse({ description: "`host` is missing or not a host name." })
  async branding(@Query() query: unknown): Promise<PublicBranding> {
    const parsed = brandingQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new BadRequestException({ code: "invalid_request", message: "Give a host name, such as summit.flooringsuite.com." });
    }
    const slug = hostCompanySlug(parsed.data.host);
    const companyId = slug ? await this.companies.idBySlug(slug) : null;
    const branding = companyId ? await publicBrandingOf(this.control.db, companyId) : null;
    if (!branding) throw new NotFoundException({ code: "not_found", message: NOT_FOUND });
    return branding;
  }
}
