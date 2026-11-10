import { dataScope, type DataScope, type Role, type User } from "@workspace/shared";
import type { CollectionName, Collections, Viewer } from "../contract";
import type { CompanyDb } from "./company-db";

/** The user whose records count as "own", and how wide the viewer may see. */
export interface ScopeSubject {
  user: User;
  scope: DataScope;
}

/**
 * Resolves whose data a viewer sees. Viewing as a role borrows that role's first active user,
 * so "own records" means that persona's records rather than none.
 */
export function scopeSubject(db: CompanyDb, viewer: Viewer): ScopeSubject {
  const roles = db.list("roles");
  const self = db.get("users", viewer.userId)!;
  if (viewer.viewAsRoleId) {
    const role = roles.find((r) => r.id === viewer.viewAsRoleId)!;
    const persona = db.list("users").find((u) => u.status === "active" && u.roleIds.includes(role.id));
    return { user: persona ?? self, scope: role.dataScope };
  }
  const held: Role[] = roles.filter((r) => self.roleIds.includes(r.id));
  return { user: self, scope: dataScope(held) };
}

type Filter = (item: never, subject: ScopeSubject, db: CompanyDb) => boolean;

const byRep: Filter = (item: { salesRepId: string; branchId: string }, { user, scope }) =>
  scope === "own" ? item.salesRepId === user.id : item.branchId === user.branchId;

/**
 * Payments, credits and write-offs follow the invoice they belong to. Reservations do not: on
 * hand, reserved and available are facts about the stock, so everyone who sees stock sees all of
 * them (audit U-03), and they carry no customer or price.
 */
function invoiceInScope(invoiceId: string, subject: ScopeSubject, db: CompanyDb): boolean {
  const invoice = db.get("invoices", invoiceId);
  return !!invoice && byRep(invoice as never, subject, db);
}

function contractInScope(contractId: string, subject: ScopeSubject, db: CompanyDb): boolean {
  const contract = db.get("contracts", contractId);
  return !!contract && byRep(contract as never, subject, db);
}

const byEmployee: Filter = (item: { employeeId: string }, { user }) => item.employeeId === user.employeeId;

/** Own records, and at branch scope a manager's direct reports too (ADR 0024: per-manager queue). */
const ownOrReports: Filter = (item: { employeeId: string }, { user, scope }, db) =>
  item.employeeId === user.employeeId ||
  (scope === "branch" && db.get("employees", item.employeeId)?.managerId === user.employeeId);

/**
 * How each collection narrows for "own" and "branch" scope (blueprint "Data scope"). Collections
 * without an entry are company-wide reference data.
 */
const FILTERS: Partial<Record<CollectionName, Filter>> = {
  quotes: byRep,
  invoices: byRep,
  customers: (item: { salesRepId: string }, { user, scope }, db) =>
    scope === "own" ? item.salesRepId === user.id : db.get("users", item.salesRepId)?.branchId === user.branchId,
  payments: (item: { invoiceId: string }, subject, db) => invoiceInScope(item.invoiceId, subject, db),
  invoiceAdjustments: (item: { invoiceId: string }, subject, db) => invoiceInScope(item.invoiceId, subject, db),
  refunds: (item: { customerId: string }, subject, db) => {
    const customer = db.get("customers", item.customerId);
    return !!customer && FILTERS.customers!(customer as never, subject, db);
  },
  jobs: (item: { crewId: string }, { user, scope }, db) =>
    scope !== "own" || db.get("crews", item.crewId)?.lead === user.name,
  timesheets: ownOrReports,
  ptoRequests: ownOrReports,
  timeOffEntries: ownOrReports,
  clockEntries: byEmployee,
  contracts: byRep,
  contractLines: (item: { contractId: string }, subject, db) => contractInScope(item.contractId, subject, db),
  changeOrders: (item: { contractId: string }, subject, db) => contractInScope(item.contractId, subject, db),
  contractBillings: (item: { contractId: string }, subject, db) => contractInScope(item.contractId, subject, db),
  meetings: (item: { attendees: { id: string }[]; private: boolean; ownerUserId: string }, { user, scope }) =>
    scope !== "own" && !item.private
      ? true
      : item.ownerUserId === user.id || item.attendees.some((a) => a.id === user.id),
};

/** The records of a collection the subject may see. */
export function applyScope<K extends CollectionName>(
  db: CompanyDb,
  name: K,
  items: Collections[K],
  subject: ScopeSubject,
): Collections[K] {
  const filter = FILTERS[name];
  if (name === "inAppNotifications" || name === "outboxMessages") return [] as unknown as Collections[K];
  if (name === "meetings") return (items as never[]).filter((item) => filter!(item, subject, db)) as Collections[K];
  if (!filter || subject.scope === "all") return items;
  return (items as never[]).filter((item) => filter(item, subject, db)) as Collections[K];
}
