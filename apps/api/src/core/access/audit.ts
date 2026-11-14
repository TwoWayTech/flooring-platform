import { Injectable, Logger, type CallHandler, type ExecutionContext, type NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { CompanyDb } from "@workspace/db";
import { auditLog } from "@workspace/db/company";
import type { AuditCategory } from "@workspace/shared";
import { sql } from "drizzle-orm";
import { from, mergeMap, type Observable } from "rxjs";
import { TenantConnectionService } from "../tenancy/tenant-connection.service";
import type { TenantContext } from "../tenancy/tenant-context";
import type { RequestAccess } from "./access.service";
import { isAudited } from "./permission.decorators";
import type { AccessRequest } from "./permission.guard";

/** One audit entry, as a handler or the interceptor describes it (spec "AuditEntry"). */
export interface AuditInput {
  category: AuditCategory;
  /** What happened, in words, such as `Created customer`. */
  action: string;
  targetType: string;
  targetId?: string | null;
  targetLabel?: string;
  before?: unknown;
  after?: unknown;
}

/** Who acted and from where, taken from the request. */
export interface AuditActor {
  access: RequestAccess;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * The moment an entry is written, by the database clock at the insert, not the transaction start
 * (`now()`): an entry written after waiting on a lock is then stamped after whatever held the lock
 * committed, so audit times follow commit order where locks order them. Payroll separation of duties
 * compares these times with `approved_at`, read from the same clock (ADR 0047; second security
 * review of PR #26).
 */
const entryClock = () => sql`clock_timestamp()`;

/**
 * Writes the company's append-only audit log (CLAUDE.md rule 10; blueprint "Security"). A module
 * calls `record` with its own transaction, so the change and its entry commit together; without one
 * it writes through the company's pool. The table refuses UPDATE, DELETE and TRUNCATE (company
 * migration 0001), so entries can never be changed.
 */
@Injectable()
export class AuditService {
  constructor(private readonly tenancy: TenantConnectionService) {}

  /** Appends one entry for the request's company. */
  async record(tenant: TenantContext, actor: AuditActor, entry: AuditInput, tx?: CompanyDb): Promise<void> {
    const db = tx ?? (await this.tenancy.db(tenant));
    await db.insert(auditLog).values({
      at: entryClock(),
      actorUserId: actor.access.userId,
      actorRole: actor.access.roleNames.join(", "),
      category: entry.category,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      targetLabel: entry.targetLabel ?? "",
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    });
  }

  /**
   * Writes an entry for something the system did on no person's behalf, such as a job raising a
   * recurring draft (CLAUDE.md rule 10). The actor is empty and the role names the job.
   */
  async recordSystem(tx: CompanyDb, actorRole: string, entry: AuditInput): Promise<void> {
    await tx.insert(auditLog).values({
      at: entryClock(),
      actorUserId: null,
      actorRole,
      category: entry.category,
      action: entry.action,
      targetType: entry.targetType,
      targetId: entry.targetId ?? null,
      targetLabel: entry.targetLabel ?? "",
      before: entry.before ?? null,
      after: entry.after ?? null,
    });
  }
}

/** Methods that change data; reads are not audited. */
const WRITE_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** The id of what a write touched: the route's `:id`, or the `id` of the record it returned. */
function targetIdOf(request: AccessRequest, body: unknown): string | null {
  const param = (request.params as Record<string, string> | undefined)?.id;
  if (param) return param;
  const returned = (body as { id?: unknown } | null)?.id;
  return typeof returned === "string" ? returned : null;
}

/**
 * The safety net for CLAUDE.md rule 10: every successful company write that did not write its own
 * entry (`@Audited()`) gets one, in category `data`, before the response is sent. It records who,
 * what route and which record, with no request body, so nothing sensitive is copied into the log.
 * Modules should still write a full entry with before and after inside their transaction.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger("Audit");

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AccessRequest>();
    const { tenant, access } = request;
    if (!tenant || !access || !WRITE_METHODS.has(request.method) || isAudited(this.reflector, context)) {
      return next.handle();
    }
    const route = (request.route as { path?: string } | undefined)?.path ?? request.path;
    return next.handle().pipe(
      mergeMap((body: unknown) =>
        from(
          this.audit
            .record(
              tenant,
              { access, ip: request.ip ?? null, userAgent: request.get("user-agent") ?? null },
              {
                category: "data",
                action: `${request.method} ${route}`,
                targetType: route,
                targetId: targetIdOf(request, body),
              },
            )
            .then(
              () => body,
              (error: unknown) => {
                // The write itself is committed; a missing entry is reported loudly, never silently.
                this.logger.error(`Could not write the audit entry for ${request.method} ${route}.`, error as Error);
                return body;
              },
            ),
        ),
      ),
    );
  }
}
