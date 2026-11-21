import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req } from "@nestjs/common";
import { dec, isStateCode, MAX_PROOF_FILES, PERCENT_TEXT } from "@workspace/shared";
import type { Request } from "express";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import { Audited, RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { DAY, requireFeature } from "../sales/sales-common";
import { ContractBillingService } from "./contract-billing.service";
import { ContractChangesService } from "./contract-changes.service";
import { ContractsService } from "./contracts.service";

/** Money as typed, never negative: digits with at most two decimals (contracts.md "Entities"). */
const MONEY = z
  .string()
  .trim()
  .regex(/^\d{1,11}(\.\d{1,2})?$/, "Enter an amount such as 2500.00.");

/** A change order row's amount, which may lower a line (spec "Change order status"). */
const DELTA = z
  .string()
  .trim()
  .regex(/^-?\d{1,11}(\.\d{1,2})?$/, "Each line needs a description and an amount.");

/**
 * A percent from 0 to 100 with up to four decimals by value; the API's own answer at numeric(18,8)
 * scale ("5.00000000") is taken back (STATUS B6). A bad format stops here (`abort`).
 */
const PERCENT = z
  .string()
  .trim()
  .regex(PERCENT_TEXT, { error: "Enter a percent such as 5.", abort: true })
  .refine((value) => dec(value).lte(100), "A percent is at most 100.");

const CATEGORY = z.enum(["material", "labor", "service", "freight"]);

const ADDRESS = z.object({
  street: z.string().max(200),
  city: z.string().max(100),
  state: z
    .string()
    .max(2)
    .transform((value) => value.trim().toUpperCase())
    .refine((value) => value === "" || isStateCode(value), "Choose a US state, such as CO."),
  zip: z.string().max(10),
  county: z.string().max(100).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

const LINE = z
  .object({
    code: z.string().trim().min(1, "Give each line a code.").max(20),
    description: z.string().trim().min(1, "Describe each line.").max(300),
    category: CATEGORY,
    billing: z.enum(["percent", "milestone"]),
    scheduledValue: MONEY,
    retainagePct: PERCENT.nullable(),
    storedRetainagePct: PERCENT.nullable(),
    milestoneDueAt: DAY.nullable(),
    // Left out by people without view_sensitive; the server then keeps the stored cost.
    estimatedCost: MONEY.optional(),
  })
  .strict();

/** A contract as the form sends it (spec "Steps in the screens", item 1). The rep is always the creator. */
const CONTRACT = z
  .object({
    direction: z.enum(["customer", "subcontractor"]),
    kind: z.enum(["master", "project"]),
    customerId: z.uuid().nullable(),
    supplierId: z.uuid().nullable(),
    title: z.string().max(200),
    scope: z.string().max(4000),
    branchId: z.uuid().nullable().optional(),
    salesRepId: z.string().optional(),
    locationId: z.uuid({ error: "Choose the warehouse." }),
    jobSite: ADDRESS,
    startsAt: DAY,
    endsAt: DAY,
    renewal: z.object({
      mode: z.enum(["none", "manual", "auto"]),
      noticeDays: z.number().int().min(0).max(3650),
    }),
    retainagePct: PERCENT,
    storedRetainagePct: PERCENT,
    bondInLieu: z.boolean(),
    taxTreatment: z.enum(["on_billing", "on_release", "contractor_pays"]),
    notes: z.string().max(10_000),
    lines: z.array(LINE).max(200),
  })
  .strict();

const SIGNATURE = z.object({ signerName: z.string().max(200), signerRole: z.string().max(200) });
const CLOSE = z.object({ overrideReason: z.string().max(500).nullable().optional() });
const REASON = z.object({ reason: z.string().max(500) });

/** Documents in the body, base64 (ADR 0038); checked again after decoding. */
const FILES = z.object({
  files: z
    .array(z.object({ name: z.string().max(200), data: z.string().max(7_000_000) }))
    .min(1, "Choose at least one file.")
    .max(MAX_PROOF_FILES, `Attach at most ${MAX_PROOF_FILES} files.`),
});

const CHANGE_ORDER = z
  .object({
    reason: z.string().max(1000),
    lines: z
      .array(
        z.object({
          contractLineId: z.uuid().nullable(),
          description: z.string().max(300),
          category: CATEGORY,
          amountDelta: DELTA,
        }),
      )
      .min(1, "Each line needs a description and an amount.")
      .max(100),
  })
  .strict();

/** A progress billing: cumulative work and stored materials per line; rates are taken on the server (spec rule 4). */
const BILLING = z
  .object({
    periodEnd: DAY,
    lines: z
      .array(
        z
          .object({
            contractLineId: z.uuid(),
            completedToDate: MONEY,
            storedBalance: MONEY,
          })
          .strict(),
      )
      .min(1, "Enter the work to date on at least one line.")
      .max(200),
  })
  .strict();

/** A retainage release: an amount above zero, up to what is held (spec rule 10). */
const RELEASE = z.object({ amount: MONEY }).strict();

const DECISION = z.object({ action: z.enum(["approve", "reject"]), reason: z.string().max(500).default("") });

const WAIVER = z
  .object({
    type: z.enum(["conditional_progress", "unconditional_progress", "conditional_final", "unconditional_final"]),
    paymentId: z.uuid().nullable(),
    supplierPaymentId: z.uuid().nullable(),
    amount: MONEY,
    throughDate: DAY,
    statutoryForm: z.boolean(),
  })
  .strict();

const CERTIFICATE = z
  .object({
    producer: z.string().trim().min(1, "Enter the agency.").max(200),
    holder: z.string().max(200),
    additionalInsured: z.boolean(),
    coverages: z
      .array(
        z.object({
          type: z.enum(["general", "auto", "umbrella", "workers_comp"]),
          insurer: z.string().max(200),
          policyNumber: z.string().max(100),
          effectiveOn: DAY,
          expiresOn: DAY,
          limits: z.string().max(200),
        }),
      )
      .min(1, "Each coverage needs an expiry date.")
      .max(10),
  })
  .strict();

/**
 * Contracts (contracts.md; ADR 0044 and 0045): the register, change orders, billings, lien waivers
 * and insurance, in the `contracts` module behind `contracts.register` (and `contracts.compliance`
 * or `contracts.billing` for those). Every write is audited.
 */
@Controller()
@RequireModule("contracts")
export class ContractsController {
  constructor(
    private readonly contracts: ContractsService,
    private readonly changes: ContractChangesService,
    private readonly billings: ContractBillingService,
  ) {}

  /** GET /contracts: the contracts the person's data scope covers. */
  @Get("contracts")
  @RequirePermission("contracts.contract.view")
  list(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("contracts.register");
    return this.contracts.list(tenant, access);
  }

  /** GET /contract-lines: the schedule lines of those contracts. */
  @Get("contract-lines")
  @RequirePermission("contracts.contract.view")
  listLines(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("contracts.register");
    return this.contracts.listLines(tenant, access);
  }

  /** GET /change-orders: the change orders of those contracts. */
  @Get("change-orders")
  @RequirePermission("contracts.contract.view")
  listChangeOrders(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("contracts.register");
    requireFeature("contracts.billing"); // change orders sit under billing (features.ts)
    return this.contracts.listChangeOrders(tenant, access);
  }

  /** GET /contract-billings: the billings of those contracts. */
  @Get("contract-billings")
  @RequirePermission("contracts.billing.view")
  listBillings(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("contracts.register");
    requireFeature("contracts.billing");
    return this.contracts.listBillings(tenant, access);
  }

  /** GET /contract-schedule: each line's billed, retained and remaining money, and what each release paid out. */
  @Get("contract-schedule")
  @RequirePermission("contracts.billing.view")
  schedule(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("contracts.register");
    requireFeature("contracts.billing");
    return this.contracts.schedule(tenant, access);
  }

  /** GET /lien-waivers: the waivers on those contracts. */
  @Get("lien-waivers")
  @RequirePermission("contracts.compliance.view")
  listWaivers(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("contracts.register");
    requireFeature("contracts.compliance");
    return this.contracts.listWaivers(tenant, access);
  }

  /** GET /insurance-certificates: the certificates on those contracts. */
  @Get("insurance-certificates")
  @RequirePermission("contracts.compliance.view")
  listCertificates(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("contracts.register");
    requireFeature("contracts.compliance");
    return this.contracts.listCertificates(tenant, access);
  }

  /** POST /contracts: a new draft. */
  @Post("contracts")
  @RequirePermission("contracts.contract.create")
  @Audited()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("contracts.register");
    return this.contracts.save(tenant, actorOf(access, session, request), null, parse(CONTRACT, body));
  }

  /** PUT /contracts/:id: edits a draft; its lines are replaced. */
  @Put("contracts/:id")
  @RequirePermission("contracts.contract.edit")
  @Audited()
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("contracts.register");
    return this.contracts.save(tenant, actorOf(access, session, request), id, parse(CONTRACT, body));
  }

  /** POST /contracts/:id/send: sends a draft for signature. */
  @Post("contracts/:id/send")
  @RequirePermission("contracts.contract.edit")
  @Audited()
  send(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    requireFeature("contracts.register");
    return this.contracts.send(tenant, actorOf(access, session, request), id);
  }

  /** POST /contracts/:id/recall: takes a sent contract back to draft. */
  @Post("contracts/:id/recall")
  @RequirePermission("contracts.contract.edit")
  @Audited()
  recall(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    requireFeature("contracts.register");
    return this.contracts.recall(tenant, actorOf(access, session, request), id);
  }

  /** POST /contracts/:id/sign: records a simulated signature. */
  @Post("contracts/:id/sign")
  @RequirePermission("contracts.contract.approve")
  @Audited()
  sign(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("contracts.register");
    return this.contracts.sign(tenant, actorOf(access, session, request), id, parse(SIGNATURE, body));
  }

  /** POST /contracts/:id/complete: marks substantial completion. */
  @Post("contracts/:id/complete")
  @RequirePermission("contracts.contract.edit")
  @Audited()
  complete(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    requireFeature("contracts.register");
    return this.contracts.complete(tenant, actorOf(access, session, request), id);
  }

  /** POST /contracts/:id/close: closes; an override needs contracts.contract.approve and a reason. */
  @Post("contracts/:id/close")
  @RequirePermission("contracts.contract.edit")
  @Audited()
  close(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("contracts.register");
    const { overrideReason } = parse(CLOSE, body);
    return this.contracts.close(tenant, actorOf(access, session, request), id, overrideReason ?? null);
  }

  /** POST /contracts/:id/terminate: ends an active or completed contract with a reason. */
  @Post("contracts/:id/terminate")
  @RequirePermission("contracts.contract.approve")
  @Audited()
  terminate(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("contracts.register");
    return this.contracts.terminate(tenant, actorOf(access, session, request), id, parse(REASON, body).reason);
  }

  /** POST /contracts/:id/renew: starts the next term as a new draft. */
  @Post("contracts/:id/renew")
  @RequirePermission("contracts.contract.create")
  @Audited()
  renew(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    requireFeature("contracts.register");
    return this.contracts.renew(tenant, actorOf(access, session, request), id);
  }

  /** POST /contracts/:id/files: adds documents. */
  @Post("contracts/:id/files")
  @RequirePermission("contracts.contract.edit")
  @Audited()
  addFiles(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("contracts.register");
    return this.contracts.addFiles(tenant, actorOf(access, session, request), id, parse(FILES, body).files);
  }

  /** POST /contracts/:id/change-orders: submits a change order for approval. */
  @Post("contracts/:id/change-orders")
  @RequirePermission("contracts.change_order.create")
  @Audited()
  submitChangeOrder(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("contracts.register");
    requireFeature("contracts.billing"); // change orders sit under billing (features.ts)
    return this.changes.submitChangeOrder(tenant, actorOf(access, session, request), id, parse(CHANGE_ORDER, body));
  }

  /** POST /change-orders/:id/decision: approves or rejects a pending change order. */
  @Post("change-orders/:id/decision")
  @RequirePermission("contracts.change_order.approve")
  @Audited()
  decideChangeOrder(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("contracts.register");
    requireFeature("contracts.billing"); // change orders sit under billing (features.ts)
    return this.changes.decideChangeOrder(tenant, actorOf(access, session, request), id, parse(DECISION, body));
  }

  /** POST /contracts/:id/billings: posts a progress billing, raising its invoice or bill. */
  @Post("contracts/:id/billings")
  @RequirePermission("contracts.billing.create")
  @Audited()
  postBilling(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("contracts.register");
    requireFeature("contracts.billing");
    return this.billings.postBilling(tenant, actorOf(access, session, request), id, parse(BILLING, body));
  }

  /** POST /contracts/:id/retainage-releases: releases held retainage on its own invoice or bill. */
  @Post("contracts/:id/retainage-releases")
  @RequirePermission("contracts.billing.create")
  @Audited()
  releaseRetainage(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("contracts.register");
    requireFeature("contracts.billing");
    const { amount } = parse(RELEASE, body);
    return this.billings.releaseRetainage(tenant, actorOf(access, session, request), id, amount);
  }

  /** POST /contract-billings/:id/void: voids the contract's latest posted billing. */
  @Post("contract-billings/:id/void")
  @RequirePermission("contracts.billing.void")
  @Audited()
  voidBilling(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("contracts.register");
    requireFeature("contracts.billing");
    return this.billings.voidBilling(tenant, actorOf(access, session, request), id, parse(REASON, body).reason);
  }

  /** POST /contracts/:id/lien-waivers: records a lien waiver. */
  @Post("contracts/:id/lien-waivers")
  @RequirePermission("contracts.compliance.manage")
  @Audited()
  recordWaiver(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("contracts.register");
    requireFeature("contracts.compliance");
    return this.changes.recordWaiver(tenant, actorOf(access, session, request), id, parse(WAIVER, body));
  }

  /** PUT /contracts/:id/insurance-certificate: saves the subcontract's one certificate. */
  @Put("contracts/:id/insurance-certificate")
  @RequirePermission("contracts.compliance.manage")
  @Audited()
  saveCertificate(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("contracts.register");
    requireFeature("contracts.compliance");
    return this.changes.saveCertificate(tenant, actorOf(access, session, request), id, parse(CERTIFICATE, body));
  }
}
