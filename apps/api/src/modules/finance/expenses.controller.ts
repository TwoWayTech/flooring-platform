import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req } from "@nestjs/common";
import { dec, MAX_PROOF_FILES, PAYMENT_METHODS } from "@workspace/shared";
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
import { ExpensesService } from "./expenses.service";

/** Money as typed: digits with at most two decimals (spec rule 3). Above zero is the rule's to say. */
const MONEY = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount such as 120.50.");

const CATEGORY = z.enum([
  "rent",
  "electricity",
  "water",
  "internet_phone",
  "supplies",
  "maintenance",
  "fuel_vehicles",
  "insurance",
  "taxes_licenses",
  "marketing",
  "professional_fees",
  "other",
  "sales_tax_payment",
  "payroll",
]);

/** Receipts in the body, base64, as payment proof (ADR 0038); checked again after decoding. */
const FILES = z
  .array(z.object({ name: z.string().max(200), data: z.string().max(7_000_000) }))
  .max(MAX_PROOF_FILES, `Attach at most ${MAX_PROOF_FILES} files.`);

/**
 * An expense as the form sends it. A draft still needs a date and an amount the database can hold
 * (blueprint-delta 2026-11-14); `expenseProblem` decides whether it may leave draft.
 */
const EXPENSE = z
  .object({
    date: DAY,
    supplierId: z.uuid().nullable(),
    category: CATEGORY,
    locationId: z.uuid().nullable(),
    amount: MONEY,
    tax: z.union([MONEY, z.literal("")]),
    paymentMethod: z.enum(PAYMENT_METHODS),
    reference: z.string().max(120),
    note: z.string().max(1000),
    settlement: z.enum(["paid", "on_account"]),
    dueAt: DAY.nullable().optional(),
    asDraft: z.boolean(),
    files: FILES.default([]),
  })
  .strict();

const REVIEW = z.discriminatedUnion("action", [
  z.object({ action: z.literal("approve") }),
  z.object({ action: z.literal("reject"), reason: z.string().max(500) }),
]);

const VOID = z.object({ reason: z.string().max(500) });

const RECURRING = z
  .object({
    supplierId: z.uuid(),
    category: CATEGORY.exclude(["payroll"]),
    locationId: z.uuid().nullable(),
    amount: MONEY.refine((value) => dec(value).gt(0), "Enter the estimated amount."),
    tax: z.union([MONEY, z.literal("")]).default("0.00"),
    paymentMethod: z.enum(PAYMENT_METHODS),
    frequency: z.enum(["monthly", "quarterly", "yearly"]),
    dayOfMonth: z.number().int().min(1).max(31),
    startsOn: DAY,
    endsOn: DAY.nullable(),
    active: z.boolean(),
    note: z.string().max(1000),
  })
  .strict();

/**
 * Finance → Expenses (finance-expenses.md; P12 part 2; ADR 0041). Behind the `finance.expenses`
 * switch, in the `core` module. Every write is audited and every confirmed expense posts.
 */
@Controller()
@RequireModule("core")
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  /** GET /expenses: the expenses the person's data scope covers. */
  @Get("expenses")
  @RequirePermission("finance.expense.view")
  list(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireFeature("finance.expenses");
    return this.expenses.list(tenant, access);
  }

  /** GET /recurring-expenses: the recurring templates. */
  @Get("recurring-expenses")
  @RequirePermission("finance.expense.view")
  listRecurring(@CurrentTenant() tenant: TenantContext) {
    requireFeature("finance.expenses");
    return this.expenses.listRecurring(tenant);
  }

  /** POST /expenses: a new draft, or a recorded expense with its receipt. */
  @Post("expenses")
  @RequirePermission("finance.expense.create")
  @Audited()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("finance.expenses");
    const { files, ...input } = parse(EXPENSE, body);
    return this.expenses.save(tenant, actorOf(access, session, request), null, input, files);
  }

  /** PUT /expenses/:id: saves or finishes a draft. */
  @Put("expenses/:id")
  @RequirePermission("finance.expense.create")
  @Audited()
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("finance.expenses");
    const { files, ...input } = parse(EXPENSE, body);
    return this.expenses.save(tenant, actorOf(access, session, request), id, input, files);
  }

  /** POST /expenses/:id/review: approve or reject; never by the recorder. */
  @Post("expenses/:id/review")
  @RequirePermission("finance.expense.approve")
  @Audited()
  review(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("finance.expenses");
    return this.expenses.review(tenant, actorOf(access, session, request), id, parse(REVIEW, body));
  }

  /** POST /expenses/:id/void: voids with a reason; a confirmed one posts its reversal. */
  @Post("expenses/:id/void")
  @RequirePermission("finance.expense.void")
  @Audited()
  void(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("finance.expenses");
    return this.expenses.void(tenant, actorOf(access, session, request), id, parse(VOID, body).reason);
  }

  /** POST /recurring-expenses: adds a template and raises what it already owes. */
  @Post("recurring-expenses")
  @RequirePermission("finance.expense.create")
  @Audited()
  addRecurring(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("finance.expenses");
    return this.expenses.saveRecurring(tenant, actorOf(access, session, request), null, parse(RECURRING, body));
  }

  /** PUT /recurring-expenses/:id: edits a template; drafts already raised keep their values. */
  @Put("recurring-expenses/:id")
  @RequirePermission("finance.expense.create")
  @Audited()
  editRecurring(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("finance.expenses");
    return this.expenses.saveRecurring(tenant, actorOf(access, session, request), id, parse(RECURRING, body));
  }
}
