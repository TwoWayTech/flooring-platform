import { Body, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { featureOn, MAX_PROOF_FILES, PAYMENT_METHODS } from "@workspace/shared";
import type { Request } from "express";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import { Audited, RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { DAY } from "../sales/sales-common";
import { PayablesService } from "./payables.service";

/** Money as typed, 11 digits at most (purchasing rules 20 and 25). Above zero is the rule's to say. */
const MONEY = z
  .string()
  .trim()
  .regex(/^\d{1,11}(\.\d{1,2})?$/, "Enter an amount such as 120.50.");

/** Files in the body, base64, as payment proof (ADR 0038); checked again after decoding. */
const FILES = z
  .array(z.object({ name: z.string().max(200), data: z.string().max(7_000_000) }))
  .max(MAX_PROOF_FILES, `Attach at most ${MAX_PROOF_FILES} files.`);

const BILL = z.object({ number: z.string().trim().min(1).max(80), issuedAt: DAY, total: MONEY, files: FILES }).strict();

const PAYMENT = z
  .object({
    supplierId: z.uuid(),
    amount: MONEY,
    date: DAY,
    method: z.enum(PAYMENT_METHODS),
    reference: z.string().max(120),
    note: z.string().max(1000),
    billIds: z.array(z.uuid()).max(200).optional(),
    files: FILES,
  })
  .strict();

const REVIEW = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("reject"), reason: z.string().max(500) }),
]);

const VOID = z.object({ reason: z.string().max(500) });

/** Bills and supplier payments sit under the purchasing switch (CLAUDE.md rule 13): off answers 404. */
function requirePayables(): void {
  if (!featureOn("purchasing.orders")) throw new NotFoundException();
}

/**
 * Payables on the API (purchasing.md rules 20 to 34; P12 part 3; ADR 0042), in the `core` module.
 * Every write is audited, and every bill and confirmed payment posts.
 */
@Controller()
@RequireModule("core")
export class PayablesController {
  constructor(private readonly payables: PayablesService) {}

  /** GET /bills: every bill, of every kind. */
  @Get("bills")
  @RequirePermission("purchasing.bill.view")
  bills(@CurrentTenant() tenant: TenantContext) {
    requirePayables();
    return this.payables.bills(tenant);
  }

  /** GET /supplier-payments: every supplier payment with its allocations. */
  @Get("supplier-payments")
  @RequirePermission("purchasing.bill.view", "purchasing.payment.record", "purchasing.payment.approve")
  payments(@CurrentTenant() tenant: TenantContext) {
    requirePayables();
    return this.payables.payments(tenant);
  }

  /** POST /purchase-orders/:id/bills: the supplier's bill for the order's unbilled receipts. */
  @Post("purchase-orders/:id/bills")
  @RequirePermission("purchasing.bill.create")
  @Audited()
  enterBill(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) poId: string,
    @Body() body: unknown,
  ) {
    requirePayables();
    const { files, ...input } = parse(BILL, body);
    return this.payables.enterBill(tenant, actorOf(access, session, request), poId, input, files);
  }

  /** POST /supplier-payments: pays a supplier's bills, with proof. */
  @Post("supplier-payments")
  @RequirePermission("purchasing.payment.record")
  @Audited()
  record(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requirePayables();
    const { files, ...input } = parse(PAYMENT, body);
    return this.payables.recordPayment(tenant, actorOf(access, session, request), input, files);
  }

  /** POST /supplier-payments/:id/review: confirm or reject; never the recorder. */
  @Post("supplier-payments/:id/review")
  @RequirePermission("purchasing.payment.approve")
  @Audited()
  review(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requirePayables();
    return this.payables.review(tenant, actorOf(access, session, request), id, parse(REVIEW, body));
  }

  /** POST /supplier-payments/:id/void: voids with a reason; a confirmed one posts its reversal. */
  @Post("supplier-payments/:id/void")
  @RequirePermission("purchasing.payment.void")
  @Audited()
  void(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requirePayables();
    return this.payables.void(tenant, actorOf(access, session, request), id, parse(VOID, body).reason);
  }
}
