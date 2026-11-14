import type { CompanyDb } from "@workspace/db";
import { contracts, customers, suppliers } from "@workspace/db/company";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { RequestAccess } from "../../core/access/access.service";
import type { AuditService } from "../../core/access/audit";
import type { Actor } from "../../core/access/request-actor";
import type { TenantContext } from "../../core/tenancy/tenant-context";
import { notFound } from "../sales/sales-common";
import { seesContract } from "./contract-records";

/** A stored contract row. */
export type ContractRow = typeof contracts.$inferSelect;

/** Contract numbers are company-wide, so one lock serialises taking them (contracts.md rule 1). */
export const NUMBER_LOCK = sql`select pg_advisory_xact_lock(hashtext('contracts:contract-number'))`;

/** How audit entries name a contract (contracts.md "Audit entries"): `<number>, <title>`. */
export const contractLabel = (row: Pick<ContractRow, "number" | "title">) => `${row.number}, ${row.title}`;

/** The contracts the person's data scope covers, by id, so their lines and papers can follow them. */
export async function visibleContractIds(db: CompanyDb, access: RequestAccess): Promise<string[]> {
  const rows = await db
    .select({ id: contracts.id, salesRepId: contracts.salesRepId, branchId: contracts.branchId })
    .from(contracts)
    .where(isNull(contracts.deletedAt));
  return rows.filter((row) => seesContract(access, row)).map((row) => row.id);
}

/**
 * Locks a contract for a write in the caller's transaction. One the person's data scope does not
 * cover answers 404, exactly like one that does not exist (CLAUDE.md rule 3).
 */
export async function lockContract(tx: CompanyDb, access: RequestAccess, id: string): Promise<ContractRow> {
  const [row] = await tx.select().from(contracts).where(eq(contracts.id, id)).for("update");
  if (!row || row.deletedAt || !seesContract(access, row)) throw notFound("contract");
  return row;
}

/** The company on the other side of a contract, as a message recipient (contracts.md "Emails"). */
export async function partyOf(
  db: CompanyDb,
  row: Pick<ContractRow, "customerId" | "supplierId">,
): Promise<{ kind: "customer" | "supplier"; id: string; name: string; email: string }> {
  if (row.customerId) {
    const [found] = await db
      .select({ id: customers.id, name: customers.name, email: customers.email })
      .from(customers)
      .where(and(eq(customers.id, row.customerId), isNull(customers.deletedAt)));
    return { kind: "customer", id: row.customerId, name: found?.name ?? "Unknown", email: found?.email ?? "" };
  }
  const [found] = await db
    .select({ id: suppliers.id, name: suppliers.name, email: suppliers.email })
    .from(suppliers)
    .where(and(eq(suppliers.id, row.supplierId ?? ""), isNull(suppliers.deletedAt)));
  return { kind: "supplier", id: row.supplierId ?? "", name: found?.name ?? "Unknown", email: found?.email ?? "" };
}

/** One audit entry about a contract, in the caller's transaction (CLAUDE.md rule 10; category `data`). */
export function auditContract(
  auditLog: AuditService,
  tenant: TenantContext,
  actor: Actor,
  tx: CompanyDb,
  action: string,
  row: Pick<ContractRow, "id" | "number" | "title">,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  return auditLog.record(
    tenant,
    actor.audit,
    {
      category: "data",
      action,
      targetType: "contract",
      targetId: row.id,
      targetLabel: contractLabel(row),
      before,
      after,
    },
    tx,
  );
}
