import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req } from "@nestjs/common";
import {
  CUSTOMER_FIELD_MESSAGES,
  dec,
  isStateCode,
  PAYMENT_TERMS,
  PERCENT_TEXT,
  QUANTITY_TEXT,
} from "@workspace/shared";
import type { Request } from "express";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import { Audited, RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { MarginRevealingFields } from "../../core/access/sensitive-fields";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { DAY, requireFeature } from "./sales-common";
import { SalesService } from "./sales.service";

const QUANTITY = z.string().regex(/^\d{1,10}(\.\d{1,3})?$/, "Enter a quantity such as 12 or 12.5.");
const PRICE = z.string().regex(/^\d{1,10}(\.\d{1,4})?$/, "Enter a price such as 3.05.");
/**
 * A percent from 0 to 100 with up to four decimals by value; the API's own answer at numeric(18,8)
 * scale ("50.00000000") is taken back (STATUS B6). A bad format stops here (`abort`), so the bound
 * never reads text decimal.js can't, which answered 500.
 */
const PERCENT = z
  .string()
  .regex(PERCENT_TEXT, { error: "Enter a percent such as 10.", abort: true })
  .refine((value) => dec(value).lte(100), "A percent is at most 100.");
/**
 * A state as stored: trimmed and uppercased, a real US code, or empty on a draft. Tax rules match
 * the code exactly, so "co" or a made-up code would collect nothing (PR #14 security review).
 */
const STATE = z
  .string()
  .max(2)
  .transform((value) => value.trim().toUpperCase())
  .refine((value) => value === "" || isStateCode(value), "Choose a US state, such as CO.");
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

/** The allowed payment terms, refused in the form's and the import's words (click-through #51). */
const TERMS = z.enum(PAYMENT_TERMS, CUSTOMER_FIELD_MESSAGES.terms);

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

/**
 * A room's width or length: a decimal string in ft, as every quantity (CLAUDE.md rule 6), up to
 * 10,000 ft. A JSON number is refused (whole-product check F-k).
 */
// The pattern runs first, but Zod still runs the refinement on text it refused, so the size is read only
// from text the pattern took (a "12,5" would otherwise throw in decimal.js and answer 500).
const ROOM_FT = QUANTITY.refine(
  (value) => !QUANTITY_TEXT.test(value) || dec(value).lte(10_000),
  "Enter a room size of at most 10,000 ft.",
);

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
        widthFt: ROOM_FT,
        lengthFt: ROOM_FT,
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
    .max(300)
    // A saved line's id stands for one line: sent twice, the copy would keep what was checked for
    // the saved line, such as a waste only a key holder may set (spec rule 8; B6 review round 1).
    .refine((lines) => new Set(lines.map((line) => line.id)).size === lines.length, "Send each line once."),
  depositPct: PERCENT,
  // Who changed the tax and when are set by the server; anything else sent is dropped.
  taxOverride: z.object({ ratePct: z.string().max(10), reason: z.string().max(500) }).nullable(),
  notes: z.string().max(5000).default(""),
});

const STATUS = z.object({
  action: z.enum(["send", "accept", "decline"]),
  expiresAt: DAY.nullable().optional(),
});

/** A switched-off feature is hidden from the API too (CLAUDE.md rule 13): its routes answer 404. */
/**
 * Sales, part 1 (docs/product-spec/sales.md "Who uses it"; ADR 0037): customers and quotes, read
 * through data scope. Every route is in the `core` module. Line costs are stripped by name for
 * anyone without `inventory.product.view_sensitive` or without margin sight (`seesMargin`,
 * click-through #68), and credit limits without `customers.customer.view_sensitive`.
 */
@Controller()
@RequireModule("core")
@MarginRevealingFields()
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
