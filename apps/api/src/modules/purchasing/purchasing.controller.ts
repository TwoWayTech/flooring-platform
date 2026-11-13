import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Req } from "@nestjs/common";
import { featureOn, type FeatureKey, type PurchaseOrder } from "@workspace/shared";
import type { Request } from "express";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import { Audited, RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { PurchasingService } from "./purchasing.service";

/** A decimal quantity or price as the screens send it: a plain decimal string, never a float. */
const QUANTITY = z.string().regex(/^\d{1,10}(\.\d{1,3})?$/, "Enter a quantity such as 12 or 12.5.");
const UNIT_COST = z.string().regex(/^\d{1,10}(\.\d{1,4})?$/, "Enter a cost such as 3.09.");
const MONEY = z.string().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount such as 2500.00.");
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.");
const ADDRESS = z.object({
  street: z.string().max(200),
  city: z.string().max(100),
  state: z.string().max(2),
  zip: z.string().max(10),
  county: z.string().max(100).optional(),
});

const SUPPLIER = z.object({
  name: z.string().max(200),
  type: z.enum(["goods", "services", "utility", "government"]).optional(),
  accountNumber: z.string().max(100).optional(),
  email: z.union([z.string().email().max(320), z.literal("")]).optional(),
  phone: z.string().max(50).optional(),
  terms: z.enum(["pay_on_order", "cod", "net_30", "net_60", "net_90", "net_180", "monthly_statement"]).optional(),
  creditLimit: MONEY.optional(),
  address: ADDRESS.optional(),
  track1099: z.boolean().optional(),
  taxForm: z
    .object({
      w9OnFile: z.boolean(),
      receivedAt: DAY.nullable(),
      legalName: z.string().max(200),
      entityType: z.string().max(100),
      exemptFromReporting: z.boolean(),
    })
    .nullable()
    .optional(),
  notes: z.string().max(2000).optional(),
  from: z.literal("order").optional(),
});

const CONTACT = z.object({
  supplierId: z.string().uuid(),
  name: z.string().max(200),
  role: z.enum(["sales_rep", "account_manager", "accounts_receivable", "other"]),
  mobile: z.string().max(50),
  officePhone: z.string().max(50),
  email: z.union([z.string().email().max(320), z.literal("")]),
  whatsapp: z.boolean(),
  preferredMethod: z.enum(["call", "email", "whatsapp"]),
  notes: z.string().max(2000),
  isPrimary: z.boolean(),
});

const STATUS = z.object({ status: z.enum(["active", "inactive"]) });

const ORDER = z.object({
  supplierId: z.string().uuid(),
  contactId: z.string().uuid().nullable(),
  supplierRef: z.string().max(100).default(""),
  placedVia: z.enum(["email", "phone"]).nullable(),
  expectedAt: DAY,
  locationId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        description: z.string().max(300),
        quantity: QUANTITY,
        unit: z.enum(["sq_ft", "each", "step", "ft", "hour"]),
        unitCost: UNIT_COST,
        sqFtPerCarton: QUANTITY.optional(),
        locationId: z.string().uuid().optional(),
      }),
    )
    .min(1)
    .max(200),
  asDraft: z.boolean(),
});

const ORDER_VIA = z.object({ via: z.enum(["email", "phone"]).default("email") });
const CANCEL = z.object({ reason: z.string().max(500) });

const RECEIPT = z.object({
  locationId: z.union([z.string().uuid(), z.literal("")]).default(""),
  lines: z
    .array(
      z.object({
        poLineId: z.string().uuid(),
        productId: z.string().uuid(),
        received: z.union([QUANTITY, z.literal("")]),
        damaged: z.union([QUANTITY, z.literal("")]),
        rolls: z
          .array(
            z.object({ rollNumber: z.string().trim().min(1).max(40), dyeLot: z.string().max(40), lengthFt: QUANTITY }),
          )
          .max(200),
        locationId: z.string().uuid().optional(),
      }),
    )
    .min(1)
    .max(200),
  note: z.string().max(1000).default(""),
});

/** A switched-off feature is hidden from the API too (CLAUDE.md rule 13): its routes answer 404. */
function requireFeature(key: FeatureKey): void {
  if (!featureOn(key)) throw new NotFoundException();
}

/**
 * Order totals are money (spec "See money columns on suppliers and orders"): only people with
 * `inventory.product.view_sensitive` or `purchasing.bill.view` see them. Line costs (`unitCost`)
 * are stripped by the response interceptor for anyone without the first key.
 */
function withMoney(access: RequestAccess, order: PurchaseOrder): PurchaseOrder | Omit<PurchaseOrder, "total"> {
  if (access.permissions.has("inventory.product.view_sensitive") || access.permissions.has("purchasing.bill.view")) {
    return order;
  }
  const rest: Partial<PurchaseOrder> = { ...order };
  delete rest.total;
  return rest as Omit<PurchaseOrder, "total">;
}

/**
 * Purchasing, part 1 (docs/product-spec/purchasing.md "Who uses it"; ADR 0036). Every route is in
 * the `core` module of Flooring Suite.
 */
@Controller()
@RequireModule("core")
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  /** GET /suppliers: the directory; credit limits are stripped without the key that reveals them. */
  @Get("suppliers")
  @RequirePermission("purchasing.supplier.view")
  suppliers(@CurrentTenant() tenant: TenantContext) {
    requireFeature("purchasing.suppliers");
    return this.purchasing.suppliers(tenant);
  }

  /** GET /supplier-contacts. */
  @Get("supplier-contacts")
  @RequirePermission("purchasing.supplier.view")
  contacts(@CurrentTenant() tenant: TenantContext) {
    requireFeature("purchasing.suppliers");
    return this.purchasing.contacts(tenant);
  }

  /** POST /suppliers: adds a supplier. */
  @Post("suppliers")
  @RequirePermission("purchasing.supplier.create")
  @Audited()
  createSupplier(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("purchasing.suppliers");
    return this.purchasing.saveSupplier(tenant, actorOf(access, session, request), null, parse(SUPPLIER, body));
  }

  /** PUT /suppliers/:id: edits a supplier. */
  @Put("suppliers/:id")
  @RequirePermission("purchasing.supplier.edit")
  @Audited()
  editSupplier(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("purchasing.suppliers");
    return this.purchasing.saveSupplier(tenant, actorOf(access, session, request), id, parse(SUPPLIER, body));
  }

  /** POST /suppliers/:id/status: deactivates or reactivates a supplier. */
  @Post("suppliers/:id/status")
  @RequirePermission("purchasing.supplier.edit")
  @Audited()
  supplierStatus(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("purchasing.suppliers");
    return this.purchasing.setSupplierStatus(tenant, actorOf(access, session, request), id, parse(STATUS, body).status);
  }

  /** POST /supplier-contacts: adds a contact. */
  @Post("supplier-contacts")
  @RequirePermission("purchasing.supplier.create")
  @Audited()
  createContact(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("purchasing.suppliers");
    return this.purchasing.saveContact(tenant, actorOf(access, session, request), null, parse(CONTACT, body));
  }

  /** PUT /supplier-contacts/:id: edits a contact. */
  @Put("supplier-contacts/:id")
  @RequirePermission("purchasing.supplier.edit")
  @Audited()
  editContact(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("purchasing.suppliers");
    return this.purchasing.saveContact(tenant, actorOf(access, session, request), id, parse(CONTACT, body));
  }

  /** POST /supplier-contacts/:id/status. */
  @Post("supplier-contacts/:id/status")
  @RequirePermission("purchasing.supplier.edit")
  @Audited()
  contactStatus(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("purchasing.suppliers");
    return this.purchasing.setContactStatus(tenant, actorOf(access, session, request), id, parse(STATUS, body).status);
  }

  /** GET /purchase-orders: orders with their lines; totals only for those who may see money. */
  @Get("purchase-orders")
  @RequirePermission("purchasing.order.view")
  async orders(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("purchasing.orders");
    return (await this.purchasing.orders(tenant)).map((order) => withMoney(access, order));
  }

  /** POST /purchase-orders: a draft, or ordered at once. */
  @Post("purchase-orders")
  @RequirePermission("purchasing.order.create")
  @Audited()
  async createOrder(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("purchasing.orders");
    return withMoney(
      access,
      await this.purchasing.createOrder(tenant, actorOf(access, session, request), parse(ORDER, body)),
    );
  }

  /** POST /purchase-orders/:id/order: sends a draft to the supplier. */
  @Post("purchase-orders/:id/order")
  @RequirePermission("purchasing.order.create")
  @Audited()
  async markOrdered(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("purchasing.orders");
    const via = parse(ORDER_VIA, body).via;
    return withMoney(access, await this.purchasing.markOrdered(tenant, actorOf(access, session, request), id, via));
  }

  /** POST /purchase-orders/:id/cancel: cancels an order before anything arrived. */
  @Post("purchase-orders/:id/cancel")
  @RequirePermission("purchasing.order.create")
  @Audited()
  async cancelOrder(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("purchasing.orders");
    const reason = parse(CANCEL, body).reason;
    return withMoney(access, await this.purchasing.cancelOrder(tenant, actorOf(access, session, request), id, reason));
  }

  /** GET /receipts: goods receipts, newest first. */
  @Get("receipts")
  @RequirePermission("purchasing.order.view")
  receipts(@CurrentTenant() tenant: TenantContext) {
    requireFeature("purchasing.orders");
    return this.purchasing.receipts(tenant);
  }

  /** POST /purchase-orders/:id/receipts: records what arrived and brings it into stock. */
  @Post("purchase-orders/:id/receipts")
  @RequirePermission("purchasing.order.receive")
  @Audited()
  recordReceipt(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("purchasing.orders");
    return this.purchasing.recordReceipt(tenant, actorOf(access, session, request), id, parse(RECEIPT, body));
  }
}
