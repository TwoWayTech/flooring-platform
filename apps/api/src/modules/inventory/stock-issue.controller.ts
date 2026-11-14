import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { featureOn, type FeatureKey } from "@workspace/shared";
import type { Request } from "express";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import { Audited, RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { StockIssueService } from "./stock-issue.service";

/** An override reason of at least 3 characters when stock leaves before payment (inventory rule 13). */
const ISSUE = z.object({ overrideReason: z.string().max(500).optional() }).strict();

/** A switched-off feature is hidden from the API too (CLAUDE.md rule 13): its routes answer 404. */
function requireFeature(key: FeatureKey): void {
  if (!featureOn(key)) throw new NotFoundException();
}

/** Ready to cut and issuing stock for a sale (inventory rules 13 to 17; inventory part 2; ADR 0043). */
@Controller()
@RequireModule("core")
export class StockIssueController {
  constructor(private readonly issues: StockIssueService) {}

  /** GET /stock-holds: active holds with the invoice number, customer and whether they may leave. */
  @Get("stock-holds")
  @RequirePermission("inventory.roll.view", "inventory.product.view")
  holds(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("inventory.reservations");
    return this.issues.holds(tenant, access);
  }

  /** POST /reservations/:id/issue: cuts or issues one hold and posts its cost of goods. */
  @Post("reservations/:id/issue")
  @RequirePermission("inventory.roll.cut")
  @Audited()
  issue(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("inventory.reservations");
    const { overrideReason } = parse(ISSUE, body);
    return this.issues.issue(tenant, actorOf(access, session, request), id, overrideReason);
  }
}
