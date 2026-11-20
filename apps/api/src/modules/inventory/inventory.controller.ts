import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put, Req } from "@nestjs/common";
import {
  featureOn,
  LOCATION_MESSAGES,
  LOCATION_NAME_MAX,
  LOCATION_RULE,
  QUANTITY_TEXT,
  QUANTITY_TEXT_MAX,
  type FeatureKey,
  type LocationInput,
} from "@workspace/shared";
import type { Request } from "express";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import { AnyCompanyMember, Audited, RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { ADDRESS_INPUT } from "../settings/settings-input";
import { requireWholeCompany } from "../settings/settings.controller";
import { InventoryService } from "./inventory.service";
import { LocationsService } from "./locations.service";

/** A decimal quantity as the screens send it: a plain decimal string, never a float (`QUANTITY_TEXT`). */
const QUANTITY = z.string().regex(QUANTITY_TEXT, "Enter a quantity such as 12 or 12.5.");

/**
 * POST /locations and PUT /locations/:id (ADR 0059, part 4a): a location as Settings → Warehouses and
 * showrooms sends it, never its id. Outer lengths sit far above the rule's, with the rule's words, so
 * the shared rule speaks first for anything a person types (part 2a's pattern); the address takes
 * part 1's bounds (D10, D12). The branch is checked by the rule against the company's live branches,
 * never cast in SQL, so a demo id gets the branch's words.
 */
const LOCATION: z.ZodType<LocationInput> = z
  .object({
    name: z.string().max(LOCATION_NAME_MAX * 10, LOCATION_MESSAGES.nameLength),
    kind: z.enum(["warehouse", "showroom"], LOCATION_MESSAGES.kind),
    branchId: z.string().max(100, LOCATION_MESSAGES.branch),
    address: ADDRESS_INPUT,
    isDefault: z.boolean(),
    displaySamples: z.number(),
    floorAreaSqFt: z
      .string()
      .max(QUANTITY_TEXT_MAX * 10, LOCATION_MESSAGES.floorArea)
      .optional(),
  })
  .strict();

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
 * interceptor for anyone without `inventory.product.view_sensitive` (CLAUDE.md rule 5). Settings
 * part 4a (ADR 0059) adds the writes of Settings → Warehouses and showrooms beside `GET /locations`.
 */
@Controller()
@RequireModule("core")
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly locationsService: LocationsService,
  ) {}

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
    requireFeature("inventory.products");
    return this.inventory.movements(tenant);
  }

  /**
   * GET /locations: warehouses and showrooms. Every module picks one, so any member of a company
   * with the `core` module may read them: shared reference data, not someone's own records
   * (an exception to `@AnyCompanyMember`'s usual meaning, recorded in docs/api-contract.md).
   */
  @Get("locations")
  @AnyCompanyMember()
  locations(@CurrentTenant() tenant: TenantContext) {
    return this.inventory.locations(tenant);
  }

  /**
   * POST /locations: adds a warehouse or showroom (ADR 0059, part 4a, D2). Stock rules' key and the
   * class's `core` module in the guard; here the page's switch (404), then data scope `all` (403),
   * then the strict body (400); the service runs the shared rules under the stock lock and audits.
   */
  @Post("locations")
  @RequirePermission(...LOCATION_RULE.keys)
  @Audited()
  createLocation(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature(LOCATION_RULE.feature);
    requireWholeCompany(access);
    return this.locationsService.create(tenant, actorOf(access, session, request), parse(LOCATION, body));
  }

  /**
   * PUT /locations/:id: changes a warehouse or showroom, in POST's order (ADR 0059, part 4a, D2). Any
   * UUID version, since the seed's ids are UUID v5; another company's id is not found (404).
   */
  @Put("locations/:id")
  @RequirePermission(...LOCATION_RULE.keys)
  @Audited()
  updateLocation(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) locationId: string,
    @Body() body: unknown,
  ) {
    requireFeature(LOCATION_RULE.feature);
    requireWholeCompany(access);
    const input = parse(LOCATION, body);
    return this.locationsService.update(tenant, actorOf(access, session, request), locationId, input);
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
