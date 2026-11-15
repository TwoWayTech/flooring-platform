import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ACCESS_LIMIT_MESSAGE,
  ADMIN_REASON_MESSAGE,
  MODULES,
  PLAN_MESSAGES as M,
  type PlatformPlan,
} from "@workspace/shared";
import { z } from "zod";
import { parse } from "../../core/access/request-actor";
import { SessionOnly } from "../../core/tenancy/access";
import { CurrentPlatformAdmin, PlatformAdminGuard, PlatformFeature, type PlatformActor } from "./platform-admin.guard";
import { PlatformPlansService } from "./plans.service";

/**
 * The plan fields' shapes (spec "The plan rules", Shapes first): each type error and length bound
 * carries its field's message, then the shared `planProblem` / `planPatchProblem` decide with the
 * spec's own messages. The bounds only keep oversized input out; the rules are tighter.
 */
const PLAN_FIELDS = {
  key: z.string({ error: M.key }).max(40, M.key),
  name: z.string({ error: M.name }).max(200, M.name),
  product: z.string({ error: M.product }).max(10, M.product),
  monthlyPrice: z.string({ error: M.monthlyPrice }).max(20, M.monthlyPrice),
  yearlyPrice: z.string({ error: M.yearlyPrice }).max(20, M.yearlyPrice),
  modules: z
    .array(z.string({ error: M.modules }).max(100, M.modules), { error: M.modules })
    .max(MODULES.length, M.modules),
  maxUsers: z.number({ error: ACCESS_LIMIT_MESSAGE }),
  maxBranches: z.number({ error: ACCESS_LIMIT_MESSAGE }),
  reason: z.string({ error: ADMIN_REASON_MESSAGE }).max(2000, ADMIN_REASON_MESSAGE),
};

/** A new plan (spec "PlatformPlanInput"), strict: every field is required and nothing else is allowed. */
const PLAN_INPUT = z.strictObject(PLAN_FIELDS);

/**
 * A plan change (spec "PlatformPlanPatch"), strict: `key`, `product` or any other field answers the
 * spec's `patchFields` message; `reason` is required, every other field optional.
 */
const PLAN_PATCH = z.strictObject(
  {
    name: PLAN_FIELDS.name.optional(),
    monthlyPrice: PLAN_FIELDS.monthlyPrice.optional(),
    yearlyPrice: PLAN_FIELDS.yearlyPrice.optional(),
    modules: PLAN_FIELDS.modules.optional(),
    maxUsers: PLAN_FIELDS.maxUsers.optional(),
    maxBranches: PLAN_FIELDS.maxBranches.optional(),
    reason: PLAN_FIELDS.reason,
  },
  { error: (issue) => (issue.code === "unrecognized_keys" ? M.patchFields : undefined) },
);

/** Retire and restore take only a reason, strict. */
const REASON_BODY = z.strictObject({ reason: PLAN_FIELDS.reason });

/** `GET /platform/plans` takes no query: any parameter answers 400. */
const NO_QUERY = z.strictObject({});

/**
 * Plans as data (docs/specs/platform-admin.md, part 2, "Endpoints (part 2)"; ADR 0056). Like every
 * /platform controller it is session-only behind PlatformAdminGuard at class level, and it carries
 * the `admin.billing` switch there too, so a handler added later inherits both: switched off, every
 * route answers 404 before the admin row is read. Any platform admin lists plans; the owner role
 * writes after a step-up (the guard's default write roles). There is no DELETE: a plan is never
 * deleted, so a plan in use never disappears and a key is never freed. `:id` is a UUID (400).
 */
@Controller("platform/plans")
@SessionOnly()
@UseGuards(PlatformAdminGuard)
@PlatformFeature("admin.billing")
export class PlatformPlansController {
  constructor(private readonly plans: PlatformPlansService) {}

  /** GET /platform/plans: every plan, retired ones included, never cached. */
  @Get()
  @Header("Cache-Control", "no-store")
  list(@Query() query: unknown): Promise<PlatformPlan[]> {
    parse(NO_QUERY, query);
    return this.plans.list();
  }

  /** POST /platform/plans: the owner role creates a plan; 201 with the plan. */
  @Post()
  create(@CurrentPlatformAdmin() admin: PlatformActor, @Body() body: unknown): Promise<PlatformPlan> {
    return this.plans.create(admin, parse(PLAN_INPUT, body));
  }

  /** PATCH /platform/plans/:id: the owner role changes a plan's name, prices, modules or limits. */
  @Patch(":id")
  change(
    @CurrentPlatformAdmin() admin: PlatformActor,
    @Param("id", new ParseUUIDPipe()) planId: string,
    @Body() body: unknown,
  ): Promise<PlatformPlan> {
    return this.plans.change(admin, planId, parse(PLAN_PATCH, body));
  }

  /** POST /platform/plans/:id/retire: the owner role retires a plan; 200, as it creates nothing. */
  @Post(":id/retire")
  @HttpCode(200)
  retire(
    @CurrentPlatformAdmin() admin: PlatformActor,
    @Param("id", new ParseUUIDPipe()) planId: string,
    @Body() body: unknown,
  ): Promise<PlatformPlan> {
    return this.plans.setActive(admin, planId, false, parse(REASON_BODY, body).reason);
  }

  /** POST /platform/plans/:id/restore: the owner role puts a retired plan back; 200. */
  @Post(":id/restore")
  @HttpCode(200)
  restore(
    @CurrentPlatformAdmin() admin: PlatformActor,
    @Param("id", new ParseUUIDPipe()) planId: string,
    @Body() body: unknown,
  ): Promise<PlatformPlan> {
    return this.plans.setActive(admin, planId, true, parse(REASON_BODY, body).reason);
  }
}
