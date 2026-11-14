import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import { Audited, RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { requireFeature } from "../sales/sales-common";
import { PortalService } from "./portal.service";

/**
 * What a person may change on their own record (employee-portal.md rule 9, `MyProfilePatch`): the
 * phone and the emergency contact, nothing else. Strict, so any other field is refused.
 */
const PROFILE = z
  .object({
    phone: z.string().max(40),
    emergencyContact: z
      .object({ name: z.string().max(120), phone: z.string().max(40), relation: z.string().max(60) })
      .strict()
      .nullable(),
  })
  .strict();

/**
 * A signature and the terms it acknowledges: the plan id, version and last change the portal showed
 * (ADR 0049). Strict, so nothing else is taken.
 */
const SIGNATURE = z
  .object({
    signedName: z.string().max(120),
    planId: z.uuid(),
    planVersion: z.number().int().positive(),
    planUpdatedAt: z.iso.datetime(),
  })
  .strict();

/**
 * The employee portal (employee-portal.md; ADR 0049), in the `hr` module, behind `hr.portal`, for
 * holders of `hr.portal.view`. Every route acts on the signed-in person only: the user from the
 * verified session and the employee linked to their sign-in; no route takes a person's id.
 */
@Controller()
@RequireModule("hr")
export class PortalController {
  constructor(private readonly portal: PortalService) {}

  /** GET /me/portal: everything the portal shows the signed-in person; hidden areas come back empty. */
  @Get("me/portal")
  @RequirePermission("hr.portal.view")
  read(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("hr.portal");
    return this.portal.portal(tenant, access);
  }

  /** PATCH /me/employee: the signed-in person's phone and emergency contact. */
  @Patch("me/employee")
  @RequirePermission("hr.portal.view")
  @Audited()
  updateProfile(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("hr.portal");
    return this.portal.updateProfile(tenant, actorOf(access, session, request), parse(PROFILE, body));
  }

  /**
   * POST /commission-assignments/:id/acknowledge: the rep signs their own plan. Commissions are a
   * Flooring Suite feature, so a company without `core` answers 404, as HR → Commissions does.
   */
  @Post("commission-assignments/:id/acknowledge")
  @RequirePermission("hr.portal.view")
  @Audited()
  async sign(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("hr.portal");
    requireFeature("hr.commissions");
    if (!access.modules.includes("core")) throw new NotFoundException();
    await this.portal.signPlan(tenant, actorOf(access, session, request), id, parse(SIGNATURE, body));
    return { ok: true };
  }
}
