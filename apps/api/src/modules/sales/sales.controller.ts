import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Put, Req } from "@nestjs/common";
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
import { SalesService } from "./sales.service";

const QUANTITY = z.string().regex(/^\d{1,10}(\.\d{1,3})?$/, "Enter a quantity such as 12 or 12.5.");
const PRICE = z.string().regex(/^\d{1,10}(\.\d{1,4})?$/, "Enter a price such as 3.05.");
const PERCENT = z.string().regex(/^\d{1,3}(\.\d{1,4})?$/, "Enter a percent such as 10.");
const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter a date.");
const STATE = z.string().regex(/^[A-Za-z]{0,2}$/, "Enter a two-letter state.");
const ADDRESS = z.object({
  street: z.string().max(200),
  city: z.string().max(100),
  state: STATE,
  zip: z.string().max(10),
  county: z.string().max(100).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});
/** An optional id; the screen sends "" for none, which reads as none. */
const OPTIONAL_ID = z
  .union([z.string().uuid(), z.literal("")])
  .optional()
  .transform((value) => value || undefined);

const TERMS = z.enum(["due_on_receipt", "net_15", "net_30", "net_45"]);

const NEW_CUSTOMER = z.object({
  name: z.string().max(200),
  phone: z.string().max(50).optional(),
  email: z.union([z.string().email().max(320), z.literal("")]).optional(),
  type: z.enum(["homeowner", "dealer", "contractor"]).optional(),
});

const CUSTOMER = z.object({
  type: z.enum(["homeowner", "dealer", "contractor"]),
  name: z.string().max(200),
  contactName: z.string().max(200),
  email: z.union([z.string().email().max(320), z.literal("")]),
  phone: z.string().max(50),
  terms: TERMS,
  defaultBillingId: z.string().max(100).nullable(),
  defaultJobSiteId: z.string().max(100).nullable(),
  addresses: z
    .array(ADDRESS.extend({ id: z.string().max(100), label: z.enum(["home", "billing", "job_site", "delivery"]) }))
    .max(50),
});

const QUOTE = z.object({
  id: OPTIONAL_ID,
  customerId: z.string().uuid(),
  locationId: z.string().uuid(),
  soldAtLocationId: OPTIONAL_ID,
  jobSite: ADDRESS,
  rooms: z
    .array(
      z.object({
        id: z.string().max(100),
        name: z.string().max(100),
        x: z.number().finite(),
        y: z.number().finite(),
        widthFt: z.number().nonnegative().max(10_000),
        lengthFt: z.number().nonnegative().max(10_000),
      }),
    )
    .max(100),
  lines: z
    .array(
      z.object({
        id: z.string().max(100),
        productId: OPTIONAL_ID,
        description: z.string().max(300),
        category: z.enum(["material", "labor", "freight", "service"]),
        unit: z.enum(["sq_ft", "each", "step", "ft", "hour"]),
        quantity: QUANTITY,
        unitPrice: PRICE,
        // Ignored: the server takes cost from the catalog (CLAUDE.md rule 5).
        unitCost: z.string().max(30).default("0"),
        wastePct: PERCENT.optional(),
        roomIds: z.array(z.string().max(100)).max(100).optional(),
        rollId: OPTIONAL_ID,
        sqFtPerCarton: QUANTITY.optional(),
        locationId: OPTIONAL_ID,
      }),
    )
    .max(300),
  depositPct: PERCENT,
  // Who changed the tax and when are set by the server, never taken from the request.
  taxOverride: z
    .object({
      ratePct: z.string().max(10),
      reason: z.string().max(500),
      byName: z.string().max(200).default(""),
      at: z.string().max(40).default(""),
    })
    .nullable(),
  notes: z.string().max(5000).default(""),
});

const STATUS = z.object({
  action: z.enum(["send", "accept", "decline"]),
  expiresAt: DAY.nullable().optional(),
});

/** A switched-off feature is hidden from the API too (CLAUDE.md rule 13): its routes answer 404. */
function requireFeature(key: FeatureKey): void {
  if (!featureOn(key)) throw new NotFoundException();
}

/**
 * Sales, part 1 (docs/product-spec/sales.md "Who uses it"; ADR 0037): customers and quotes, read
 * through data scope. Every route is in the `core` module. Line costs are stripped by name for
 * anyone without `inventory.product.view_sensitive`, and credit limits without
 * `customers.customer.view_sensitive`.
 */
@Controller()
@RequireModule("core")
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  /** GET /customers: the customers the person may see. */
  @Get("customers")
  @RequirePermission("customers.customer.view")
  customers(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("sales.customers");
    return this.sales.customers(tenant, access);
  }

  /** POST /customers: adds a customer with only a name. */
  @Post("customers")
  @RequirePermission("customers.customer.create")
  @Audited()
  createCustomer(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("sales.customers");
    return this.sales.createCustomer(tenant, actorOf(access, session, request), parse(NEW_CUSTOMER, body));
  }

  /** PUT /customers/:id: changes a customer and their addresses. */
  @Put("customers/:id")
  @RequirePermission("customers.customer.edit")
  @Audited()
  saveCustomer(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("sales.customers");
    return this.sales.saveCustomer(tenant, actorOf(access, session, request), id, parse(CUSTOMER, body));
  }

  /** GET /quotes: the quotes the person may see. */
  @Get("quotes")
  @RequirePermission("sales.quote.view")
  quotes(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("sales.quotes");
    return this.sales.quotes(tenant, access);
  }

  /** POST /quotes: creates a quote (`sales.quote.create`). */
  @Post("quotes")
  @RequirePermission("sales.quote.create")
  @Audited()
  createQuote(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("sales.quotes");
    const input = parse(QUOTE, body);
    return this.sales.saveQuote(tenant, actorOf(access, session, request), { ...input, id: undefined });
  }

  /** PUT /quotes/:id: saves an open quote (`sales.quote.edit`). */
  @Put("quotes/:id")
  @RequirePermission("sales.quote.edit")
  @Audited()
  saveQuote(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("sales.quotes");
    return this.sales.saveQuote(tenant, actorOf(access, session, request), { ...parse(QUOTE, body), id });
  }

  /** POST /quotes/:id/status: sends, accepts or declines a quote. */
  @Post("quotes/:id/status")
  @RequirePermission("sales.quote.edit")
  @Audited()
  status(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("sales.quotes");
    const change = parse(STATUS, body);
    return this.sales.updateQuoteStatus(tenant, actorOf(access, session, request), id, change.action, change.expiresAt);
  }
}
