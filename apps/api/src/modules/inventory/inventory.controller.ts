import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Req } from "@nestjs/common";
import { featureOn, type FeatureKey } from "@workspace/shared";
import type { Request } from "express";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import { AnyCompanyMember, Audited, RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { InventoryService } from "./inventory.service";

/** A decimal quantity as the screens send it: a plain decimal string, never a float. */
const QUANTITY = z.string().regex(/^\d{1,10}(\.\d{1,3})?$/, "Enter a quantity such as 12 or 12.5.");

/** POST /transfers. */
const TRANSFER = z.object({
  fromId: z.string().uuid(),
  toId: z.string().uuid(),
  lines: z
    .array(z.object({ productId: z.string().uuid(), rollId: z.string().uuid().nullable(), quantity: QUANTITY }))
    .min(1)
    .max(200),
  note: z.string().max(500).default(""),
});

/** PATCH /rolls/:id: the bin only (spec `assertRollEditOnly`). */
const ROLL_MOVE = z.object({ bin: z.string().trim().min(1).max(40) }).strict();

/** POST /stock/corrections. */
const CORRECTION = z.object({
  productId: z.string().uuid(),
  rollId: z.string().uuid().nullable(),
  locationId: z.string().uuid(),
  counted: QUANTITY,
  reason: z.string().max(500),
});

/** A switched-off feature is hidden from the API too (CLAUDE.md rule 13): its routes answer 404. */
function requireFeature(key: FeatureKey): void {
  if (!featureOn(key)) throw new NotFoundException();
}

/**
 * Inventory, part 1 (docs/product-spec/inventory.md "Who uses it"; ADR 0035). Every route is in the
 * `core` module of Flooring Suite. Product and roll costs are stripped by the response
 * interceptor for anyone without `inventory.product.view_sensitive` (CLAUDE.md rule 5).
 */
@Controller()
@RequireModule("core")
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  /** GET /products: the catalog. */
  @Get("products")
  @RequirePermission("inventory.product.view")
  products(@CurrentTenant() tenant: TenantContext) {
    requireFeature("inventory.products");
    return this.inventory.products(tenant);
  }

  /** GET /rolls: rolls and remnants with their cuts. */
  @Get("rolls")
  @RequirePermission("inventory.roll.view")
  rolls(@CurrentTenant() tenant: TenantContext) {
    requireFeature("inventory.rolls");
    return this.inventory.rolls(tenant);
  }

  /** GET /stock-movements: the boxed-stock ledger. */
  @Get("stock-movements")
  @RequirePermission("inventory.product.view")
  movements(@CurrentTenant() tenant: TenantContext) {
    return this.inventory.movements(tenant);
  }

  /** GET /locations: warehouses and showrooms; every module picks one, so any member may read them. */
  @Get("locations")
  @AnyCompanyMember()
  locations(@CurrentTenant() tenant: TenantContext) {
    return this.inventory.locations(tenant);
  }

  /** GET /transfers: transfers between warehouses, newest first. */
  @Get("transfers")
  @RequirePermission("inventory.transfer.view")
  transfers(@CurrentTenant() tenant: TenantContext) {
    requireFeature("inventory.transfers");
    return this.inventory.transfers(tenant);
  }

  /** POST /transfers: starts a transfer. */
  @Post("transfers")
  @RequirePermission("inventory.transfer.create")
  @Audited()
  createTransfer(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("inventory.transfers");
    return this.inventory.createTransfer(tenant, actorOf(access, session, request), parse(TRANSFER, body));
  }

  /** POST /transfers/:id/receive: receives a transfer at its destination. */
  @Post("transfers/:id/receive")
  @RequirePermission("inventory.transfer.receive")
  @Audited()
  receiveTransfer(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) transferId: string,
  ) {
    requireFeature("inventory.transfers");
    return this.inventory.receiveTransfer(tenant, actorOf(access, session, request), transferId);
  }

  /** PATCH /rolls/:id: moves a roll to another bin. */
  @Patch("rolls/:id")
  @RequirePermission("inventory.roll.edit")
  @Audited()
  moveRoll(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) rollId: string,
    @Body() body: unknown,
  ) {
    requireFeature("inventory.rolls");
    return this.inventory.moveRoll(tenant, actorOf(access, session, request), rollId, parse(ROLL_MOVE, body).bin);
  }

  /** POST /stock/corrections: sets stock to a counted quantity, with a reason (Owner by default). */
  @Post("stock/corrections")
  @RequirePermission("inventory.stock.correct")
  @Audited()
  correct(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("inventory.stock-correction");
    return this.inventory.correctStock(tenant, actorOf(access, session, request), parse(CORRECTION, body));
  }
}
