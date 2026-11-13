import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, Res, StreamableFile } from "@nestjs/common";
import { MAX_PROOF_FILES } from "@workspace/shared";
import type { Request, Response } from "express";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import { Audited, RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { InvoicesService } from "./invoices.service";
import { PaymentsService } from "./payments.service";
import { DAY, requireFeature } from "./sales-common";

/** Money as typed: digits with at most two decimals (spec rule 25). Above zero is the rule's to say. */
const MONEY = z
  .string()
  .trim()
  .max(15)
  .regex(/^\d+(\.\d{1,2})?$/, "Enter an amount such as 120.50.");
const METHOD = z.enum(["cash", "check", "ach", "card", "other"]);
const REASON = z.object({ reason: z.string().max(500) });

/**
 * Proof files in the body, base64 (ADR 0038). 5 MB of bytes is just under 7 million base64
 * characters; the real size and type are checked again after decoding (spec rule 27).
 */
const FILES = z
  .array(z.object({ name: z.string().max(200), data: z.string().max(7_000_000) }))
  .max(MAX_PROOF_FILES, `Attach at most ${MAX_PROOF_FILES} files.`);

const RECORD_PAYMENT = z.object({
  invoiceId: z.string().uuid(),
  kind: z.enum(["payment", "deposit"]),
  amount: MONEY,
  date: DAY,
  method: METHOD,
  checkNumber: z.string().max(20),
  cardLast4: z.string().max(4),
  reference: z.string().max(100),
  note: z.string().max(1000),
  extraAsCredit: z.boolean(),
  allowDuplicateReference: z.boolean(),
  files: FILES,
});

const REVIEW = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }),
  z.object({ action: z.literal("reject"), reason: z.string().max(500) }),
]);

const CREDIT_NOTE = z.object({ subtotal: MONEY, reason: z.string().max(500) });

const REFUND = z.object({
  customerId: z.string().uuid(),
  amount: MONEY,
  date: DAY,
  method: METHOD,
  reference: z.string().max(100),
  note: z.string().max(1000),
  files: FILES,
});

const ATTACH = z.object({ files: FILES });

/** A file name safe inside a Content-Disposition header: no quotes, slashes or control characters. */
function safeFileName(name: string): string {
  return name.replace(/[^\w .()-]/g, "_").slice(0, 150) || "proof";
}

/**
 * Sales, part 2 (docs/product-spec/sales.md "Conversion and invoices", "Payments", "Corrections";
 * ADR 0038): invoices, payments, credits, write-offs, refunds and the stock they hold. Every route
 * is in the `core` module and switched by the Invoices or Payments feature. Invoice cost and line
 * cost are stripped by name without `inventory.product.view_sensitive`.
 */
@Controller()
@RequireModule("core")
export class InvoicesController {
  constructor(
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
  ) {}

  /** GET /invoices: invoices and credit notes within the person's data scope. */
  @Get("invoices")
  @RequirePermission("sales.invoice.view")
  list(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("sales.invoices");
    return this.invoices.invoices(tenant, access);
  }

  /** GET /payments: payments on invoices within scope, for invoice viewers and approvers. */
  @Get("payments")
  @RequirePermission("sales.invoice.view", "sales.payment.approve")
  paymentList(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("sales.invoices");
    return this.invoices.payments(tenant, access);
  }

  /** GET /invoice-adjustments: write-offs and credit applied, within scope. */
  @Get("invoice-adjustments")
  @RequirePermission("sales.invoice.view")
  adjustments(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("sales.invoices");
    return this.invoices.adjustments(tenant, access);
  }

  /** GET /refunds: refunds to customers within scope. */
  @Get("refunds")
  @RequirePermission("sales.invoice.view", "sales.payment.refund")
  refunds(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("sales.invoices");
    return this.invoices.refunds(tenant, access);
  }

  /** GET /reservations: stock held for invoices, for warehouse staff and invoice viewers. */
  @Get("reservations")
  @RequirePermission("inventory.product.view", "inventory.roll.view", "sales.invoice.view")
  reservations(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    return this.invoices.reservations(tenant, access);
  }

  /** POST /quotes/:id/invoice: converts an accepted quote into an invoice and holds its stock. */
  @Post("quotes/:id/invoice")
  @RequirePermission("sales.invoice.create")
  @Audited()
  convert(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    requireFeature("sales.invoices");
    return this.invoices.convert(tenant, actorOf(access, session, request), id);
  }

  /** POST /invoices/:id/sent: marks an invoice sent and emails it. */
  @Post("invoices/:id/sent")
  @RequirePermission("sales.invoice.edit", "sales.invoice.create")
  @Audited()
  markSent(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    requireFeature("sales.invoices");
    return this.invoices.markSent(tenant, actorOf(access, session, request), id);
  }

  /** POST /invoices/:id/void: voids an invoice with no confirmed payment. */
  @Post("invoices/:id/void")
  @RequirePermission("sales.invoice.void")
  @Audited()
  voidInvoice(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("sales.invoices");
    return this.invoices.voidInvoice(tenant, actorOf(access, session, request), id, parse(REASON, body).reason);
  }

  /** POST /invoices/:id/credit-notes: issues a credit note for part of an invoice. */
  @Post("invoices/:id/credit-notes")
  @RequirePermission("sales.invoice.void")
  @Audited()
  creditNote(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("sales.invoices");
    return this.invoices.creditNote(tenant, actorOf(access, session, request), id, parse(CREDIT_NOTE, body));
  }

  /** POST /invoices/:id/write-off: writes off a small leftover balance. */
  @Post("invoices/:id/write-off")
  @RequirePermission("sales.payment.write_off")
  @Audited()
  writeOff(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("sales.payments");
    return this.invoices.writeOff(tenant, actorOf(access, session, request), id, parse(REASON, body).reason);
  }

  /** POST /invoices/:id/apply-credit: applies the customer's credit to the invoice. */
  @Post("invoices/:id/apply-credit")
  @RequirePermission("sales.payment.apply_credit")
  @Audited()
  applyCredit(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    requireFeature("sales.payments");
    return this.invoices.applyCredit(tenant, actorOf(access, session, request), id);
  }

  /** POST /payments: records a payment or deposit with its proof. */
  @Post("payments")
  @RequirePermission("sales.payment.record")
  @Audited()
  record(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("sales.payments");
    const { files, ...input } = parse(RECORD_PAYMENT, body);
    return this.payments.record(tenant, actorOf(access, session, request), input, files);
  }

  /** POST /payments/:id/review: confirms or rejects a pending payment. */
  @Post("payments/:id/review")
  @RequirePermission("sales.payment.approve")
  @Audited()
  review(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("sales.payments");
    return this.payments.review(tenant, actorOf(access, session, request), id, parse(REVIEW, body));
  }

  /** POST /payments/:id/void: voids a payment with a reason. */
  @Post("payments/:id/void")
  @RequirePermission("sales.payment.void")
  @Audited()
  voidPayment(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("sales.payments");
    return this.payments.voidPayment(tenant, actorOf(access, session, request), id, parse(REASON, body).reason);
  }

  /** POST /payments/:id/files: adds proof files to a payment. */
  @Post("payments/:id/files")
  @RequirePermission("sales.payment.record")
  @Audited()
  attach(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("sales.payments");
    return this.payments.attachFiles(tenant, actorOf(access, session, request), id, parse(ATTACH, body).files);
  }

  /** POST /refunds: refunds customer credit with proof. */
  @Post("refunds")
  @RequirePermission("sales.payment.refund")
  @Audited()
  refund(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("sales.payments");
    const { files, ...input } = parse(REFUND, body);
    return this.payments.refund(tenant, actorOf(access, session, request), input, files);
  }

  /** GET /files/:id: a proof file, opened in place; only within the person's data scope. */
  @Get("files/:id")
  @RequirePermission("sales.invoice.view", "sales.payment.approve", "sales.payment.refund")
  async file(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const file = await this.payments.file(tenant, access, id);
    response.set({
      "Content-Type": file.contentType,
      "Content-Disposition": `inline; filename="${safeFileName(file.name)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    });
    return new StreamableFile(file.body);
  }
}
