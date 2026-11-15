import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
  type HttpException,
} from "@nestjs/common";
import type { ControlDb, DbHandle } from "@workspace/db";
import { planLimits, planModules, plans, products } from "@workspace/db/control";
import {
  ACCESS_LIMIT_MESSAGE,
  adminReasonProblem,
  inModuleOrder,
  isModuleKey,
  isPlanProduct,
  newPlanValues,
  PLAN_MESSAGES,
  planAuditBody,
  planChanges,
  planPatchProblem,
  planProblem,
  PLATFORM_DEFAULT_WRITE_ROLES,
  type ModuleKey,
  type PlanChanges,
  type PlanProblem,
  type PlatformPlan,
  type PlatformPlanInput,
  type PlatformPlanPatch,
} from "@workspace/shared";
import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { CONTROL_DB } from "../../core/database/control-db";
import { lockActingAdmin } from "./admin-lock";
import type { PlatformActor } from "./platform-admin.guard";
import { PlatformAuditService } from "./platform-audit.service";

/** A new plan as the controller's schema lets it through: shapes only, before the plan rules. */
export interface PlanBody {
  key: string;
  name: string;
  product: string;
  monthlyPrice: string;
  yearlyPrice: string;
  modules: string[];
  maxUsers: number;
  maxBranches: number;
  reason: string;
}

/** A plan change as the controller's schema lets it through; any other field was already refused. */
export interface PlanPatchBody {
  name?: string;
  monthlyPrice?: string;
  yearlyPrice?: string;
  modules?: string[];
  maxUsers?: number;
  maxBranches?: number;
  reason: string;
}

/** The answer for a plan id that names no plan, or a deleted one (spec "Validations and messages (part 2)"). */
function planNotFound(): NotFoundException {
  return new NotFoundException({ code: "not_found", message: PLAN_MESSAGES.notFound });
}

function invalid(message: string): BadRequestException {
  return new BadRequestException({ code: "invalid_request", message });
}

/** The API answer for a refusal of the plan rules: 400 `invalid_request` or 422 `rule_broken`. */
function refusal(problem: PlanProblem): HttpException {
  return problem.status === 400
    ? invalid(problem.message)
    : new UnprocessableEntityException({ code: "rule_broken", message: problem.message });
}

/** The plan columns the console reads, with the product's key, the live limits row and the company count. */
const PLAN_COLUMNS = {
  id: plans.id,
  key: plans.key,
  name: plans.name,
  product: products.key,
  monthlyPrice: plans.monthlyPrice,
  yearlyPrice: plans.yearlyPrice,
  active: plans.active,
  maxUsers: planLimits.maxUsers,
  maxBranches: planLimits.maxBranches,
  // In use means any subscription row names the plan, deleted rows and deleted companies included
  // (spec "A plan in use"), so the count reads every row. Only the count leaves, never a company.
  companies:
    sql<number>`(select count(distinct ts.tenant_id) from tenant_subscriptions ts where ts.plan_id = ${plans.id})`.mapWith(
      Number,
    ),
  createdAt: plans.createdAt,
  updatedAt: plans.updatedAt,
};

/**
 * Plans as data in the platform console (docs/specs/platform-admin.md, part 2, "Plans"; ADR 0056).
 * PlatformAdminGuard has already checked the switch, the admin, the owner role and, for a write, a
 * fresh step-up; the controller has checked the body's shape. Every write is one control
 * transaction that locks the acting admin's own row first (`lockActingAdmin`, 403), then the plan
 * row, checks the shared plan rules, writes and adds one `platform_audit_log` row; a refusal or a
 * save that changes nothing writes nothing.
 * - A plan in use (any subscription row names it) keeps its modules and limits: only a plan's live
 *   `plan_modules` and `plan_limits` rows reach a company's access, so no company's access, limits or
 *   ladder changes. A rename shows on its companies' billing pages; prices and `active` are read
 *   nowhere for access or charging (spec "A plan in use, and what a plan edit reaches").
 * - No plan is ever deleted and a key is never reused (`plans_key_uidx` covers deleted rows too).
 * No company database is read or written.
 */
@Injectable()
export class PlatformPlansService {
  constructor(
    @Inject(CONTROL_DB) private readonly control: DbHandle<ControlDb>,
    private readonly audit: PlatformAuditService,
  ) {}

  /** Every plan that is not deleted, retired ones included, by product key, then name, then key. */
  list(): Promise<PlatformPlan[]> {
    return plansWhere(this.control.db);
  }

  /**
   * Creates a plan (spec "POST /platform/plans"): lock and re-check the admin (403), the plan rules
   * (400), the product row (400), then insert the plan, its modules and its limits, each with
   * `created_by`, and one `plan.created` row. The insert does nothing on a taken key, a deleted or
   * retired plan's included: 409 `conflict`. A parallel create of the same key waits on the unique
   * index for the other one, so the later one gets the same 409, with no 23505 to catch.
   */
  async create(actor: PlatformActor, body: PlanBody): Promise<PlatformPlan> {
    return this.control.db.transaction(async (tx) => {
      await lockActingAdmin(tx, actor.userId, PLATFORM_DEFAULT_WRITE_ROLES);
      const values = newPlanValues(checkedInput(body));
      const [product] = await tx
        .select({ id: products.id })
        .from(products)
        .where(and(eq(products.key, values.product), isNull(products.deletedAt)));
      if (!product) throw invalid(PLAN_MESSAGES.product);
      const [created] = await tx
        .insert(plans)
        .values({
          key: values.key,
          name: values.name,
          productId: product.id,
          monthlyPrice: values.monthlyPrice,
          yearlyPrice: values.yearlyPrice,
          createdBy: actor.userId,
        })
        .onConflictDoNothing({ target: plans.key })
        .returning({ id: plans.id });
      if (!created) throw new ConflictException({ code: "conflict", message: PLAN_MESSAGES.keyTaken });
      await tx
        .insert(planModules)
        .values(values.modules.map((module) => ({ planId: created.id, module, createdBy: actor.userId })));
      await tx.insert(planLimits).values({
        planId: created.id,
        maxUsers: values.maxUsers,
        maxBranches: values.maxBranches,
        createdBy: actor.userId,
      });
      await this.audit.record(tx, actor, {
        action: "plan.created",
        tenantId: null,
        targetType: "plan",
        targetId: created.id,
        ...planAuditBody({ action: "plan.created", plan: values, reason: body.reason }),
      });
      return planOf(tx, created.id);
    });
  }

  /**
   * Changes a plan's name, prices, modules or limits (spec "PATCH /platform/plans/:id"): lock and
   * re-check the admin (403), lock the plan row (404), the plan rules and the in-use rule (400,
   * 422), then write only what differs and one `plan.changed` row. A save that changes nothing
   * writes nothing. The plan row's lock conflicts with the key-share lock a subscription insert
   * takes through its foreign key, so the in-use check can't race one; two edits run one after the
   * other and the last one wins, both audited (owner question 46).
   */
  async change(actor: PlatformActor, planId: string, body: PlanPatchBody): Promise<PlatformPlan> {
    return this.control.db.transaction(async (tx) => {
      await lockActingAdmin(tx, actor.userId, PLATFORM_DEFAULT_WRITE_ROLES);
      const plan = await lockPlan(tx, planId);
      const problem = planPatchProblem(plan, body, plan.companies > 0);
      if (problem) throw refusal(problem);
      const patch: PlatformPlanPatch = { ...body, modules: body.modules?.filter(isModuleKey) };
      const changes = planChanges(plan, patch);
      if (!changes) return plan;
      await writeChanges(tx, actor, plan, changes, limitsAfter(plan, changes));
      await this.audit.record(tx, actor, {
        action: "plan.changed",
        tenantId: null,
        targetType: "plan",
        targetId: planId,
        ...planAuditBody({ action: "plan.changed", changes, reason: body.reason }),
      });
      return planOf(tx, planId);
    });
  }

  /**
   * Retires (`active` false) or restores a plan (spec "POST /platform/plans/:id/retire and
   * /restore"): lock and re-check the admin (403), lock the plan row (404), the reason (400), then
   * 409 when it already is so, else flip `active` and write one `plan.retired` or `plan.restored`
   * row. Nothing reads `plans.active` for access, so no company changes (owner question 44).
   */
  async setActive(actor: PlatformActor, planId: string, active: boolean, reason: string): Promise<PlatformPlan> {
    return this.control.db.transaction(async (tx) => {
      await lockActingAdmin(tx, actor.userId, PLATFORM_DEFAULT_WRITE_ROLES);
      const plan = await lockPlan(tx, planId);
      const reasonProblem = adminReasonProblem(reason);
      if (reasonProblem) throw invalid(reasonProblem);
      if (plan.active === active) {
        const message = active ? PLAN_MESSAGES.notRetired : PLAN_MESSAGES.alreadyRetired;
        throw new ConflictException({ code: "conflict", message });
      }
      await tx.update(plans).set({ active, updatedAt: new Date() }).where(eq(plans.id, planId));
      const action = active ? "plan.restored" : "plan.retired";
      await this.audit.record(tx, actor, {
        action,
        tenantId: null,
        targetType: "plan",
        targetId: planId,
        ...planAuditBody({ action, reason }),
      });
      return planOf(tx, planId);
    });
  }
}

/**
 * A new plan checked by the shared plan rules (spec "The plan rules", `planProblem`): the first
 * problem answers 400 with its message. After it passes, the product and every module are known
 * keys, so the typed input is rebuilt from the checked values, not asserted.
 */
function checkedInput(body: PlanBody): PlatformPlanInput {
  const problem = planProblem(body);
  if (problem) throw invalid(problem.message);
  if (!isPlanProduct(body.product)) throw invalid(PLAN_MESSAGES.product);
  return { ...body, product: body.product, modules: body.modules.filter(isModuleKey) };
}

/** Locks a plan row that is not deleted for the rest of the transaction and reads it; 404 otherwise. */
async function lockPlan(tx: ControlDb, planId: string): Promise<PlatformPlan> {
  // The plan row alone: a join here would lock the product row too.
  const [locked] = await tx
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.id, planId), isNull(plans.deletedAt)))
    .for("update");
  if (!locked) throw planNotFound();
  const [plan] = await plansWhere(tx, eq(plans.id, planId));
  if (!plan) throw planNotFound();
  return plan;
}

/** One plan read again inside the write's transaction, as the answer. */
async function planOf(tx: ControlDb, planId: string): Promise<PlatformPlan> {
  const [plan] = await plansWhere(tx, eq(plans.id, planId));
  if (!plan) throw planNotFound();
  return plan;
}

/**
 * The plans that are not deleted and match `where`, read as the console shows them (spec "GET
 * /platform/plans"): one query for the plans with their product key, live limits row and company
 * count, a second for their live `plan_modules` rows. Unknown module values and `platform` are left
 * out; a stored hidden module stays. A plan whose product key is not one of the two is left out
 * (deny by default; the products table holds only those two).
 */
async function plansWhere(db: ControlDb, where?: SQL): Promise<PlatformPlan[]> {
  const rows = await db
    .select(PLAN_COLUMNS)
    .from(plans)
    .innerJoin(products, eq(products.id, plans.productId))
    .leftJoin(planLimits, and(eq(planLimits.planId, plans.id), isNull(planLimits.deletedAt)))
    .where(and(isNull(plans.deletedAt), where))
    .orderBy(asc(products.key), asc(plans.name), asc(plans.key));
  if (rows.length === 0) return [];
  const moduleRows = await db
    .select({ planId: planModules.planId, module: planModules.module })
    .from(planModules)
    .where(
      and(
        inArray(
          planModules.planId,
          rows.map((row) => row.id),
        ),
        isNull(planModules.deletedAt),
      ),
    );
  const modulesOf = (planId: string): ModuleKey[] =>
    inModuleOrder(
      moduleRows
        .filter((row) => row.planId === planId)
        .map((row) => String(row.module))
        .filter(isModuleKey)
        .filter((module) => module !== "platform"),
    );
  return rows.flatMap((row) => {
    const product = row.product;
    if (!isPlanProduct(product)) return [];
    return [
      {
        id: row.id,
        key: row.key,
        name: row.name,
        product,
        monthlyPrice: row.monthlyPrice,
        yearlyPrice: row.yearlyPrice,
        modules: modulesOf(row.id),
        maxUsers: row.maxUsers,
        maxBranches: row.maxBranches,
        active: row.active,
        companies: row.companies,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    ];
  });
}

/** Both limits a plan has after a change. */
interface PlanLimitValues {
  maxUsers: number;
  maxBranches: number;
}

/**
 * The limits row a change writes, or null when no limit changes. A plan with no live limits row
 * (only possible by SQL; it means no limit) gets one only when both limits are sent: the console
 * never invents the other one, so a single limit answers 400 with the limits' message.
 */
function limitsAfter(plan: PlatformPlan, changes: PlanChanges): PlanLimitValues | null {
  const { maxUsers, maxBranches } = changes.after;
  if (maxUsers === undefined && maxBranches === undefined) return null;
  const users = maxUsers ?? plan.maxUsers;
  const branches = maxBranches ?? plan.maxBranches;
  if (users === null || branches === null) throw invalid(ACCESS_LIMIT_MESSAGE);
  return { maxUsers: users, maxBranches: branches };
}

/**
 * Writes a plan change (spec "PATCH /platform/plans/:id", step 6): the name and prices on `plans`;
 * the modules as rows, each wanted one upserted with `deleted_at` cleared and each removed one
 * soft-deleted, while a stored module the console doesn't offer (hidden or foreign) is never touched,
 * because `planModulesAfter` keeps it in the new list; and the limits row upserted on `plan_id`.
 */
async function writeChanges(
  tx: ControlDb,
  actor: PlatformActor,
  plan: PlatformPlan,
  changes: PlanChanges,
  limits: PlanLimitValues | null,
): Promise<void> {
  const now = new Date();
  const { name, monthlyPrice, yearlyPrice, modules } = changes.after;
  await tx.update(plans).set({ name, monthlyPrice, yearlyPrice, updatedAt: now }).where(eq(plans.id, plan.id));
  if (modules) await writeModules(tx, actor, plan.id, plan.modules, modules, now);
  if (limits) {
    await tx
      .insert(planLimits)
      .values({ planId: plan.id, ...limits, createdBy: actor.userId })
      .onConflictDoUpdate({ target: planLimits.planId, set: { ...limits, deletedAt: null, updatedAt: now } });
  }
}

/**
 * A plan's module rows after a change: the unique index on (plan, module) ignores `deleted_at`, so an
 * upsert brings a removed module back; a module that left the list is soft-deleted.
 */
async function writeModules(
  tx: ControlDb,
  actor: PlatformActor,
  planId: string,
  stored: readonly ModuleKey[],
  wanted: readonly ModuleKey[],
  now: Date,
): Promise<void> {
  await tx
    .insert(planModules)
    .values(wanted.map((module) => ({ planId, module, createdBy: actor.userId })))
    .onConflictDoUpdate({
      target: [planModules.planId, planModules.module],
      set: { deletedAt: null, updatedAt: now },
    });
  const removed = stored.filter((module) => !wanted.includes(module));
  if (removed.length === 0) return;
  await tx
    .update(planModules)
    .set({ deletedAt: now, updatedAt: now })
    .where(and(eq(planModules.planId, planId), inArray(planModules.module, removed), isNull(planModules.deletedAt)));
}
