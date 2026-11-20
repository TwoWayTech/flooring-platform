import { roleTemplate, sensitiveKeyFor, type Invoice, type PermissionKey } from "../src";

/** What the Sales role holds: neither product cost nor margin. */
export const SALES: ReadonlySet<PermissionKey> = new Set(roleTemplate("sales").permissions);

/**
 * A copy of `value` as the API sends it to someone holding `held`: every property whose name is a
 * sensitive field (SENSITIVE_FIELDS) the viewer may not see is left out, at any depth. It models the
 * API's `stripSensitive` without importing the API.
 */
export function strippedFor<T>(value: T, held: ReadonlySet<PermissionKey>): T {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (node === null || typeof node !== "object") return node;
    return Object.fromEntries(
      Object.entries(node)
        .filter(([field]) => {
          const key = sensitiveKeyFor(field);
          return key === undefined || held.has(key);
        })
        .map(([field, inner]) => [field, strip(inner)]),
    );
  };
  return strip(value) as T;
}

/**
 * A copy of `invoice` as `GET /invoices` hands it to the field strip: a contract invoice loses its
 * `cost` and every line's `unitCost` without `contracts.contract.view_sensitive`, because its cost is
 * the contract's estimated cost share (CLAUDE.md rule 5). It models the API's `contractCostShown`
 * (invoices.service.ts) without importing the API.
 */
export function contractCostStripped<T extends Pick<Invoice, "contractId" | "lines">>(
  invoice: T,
  held: ReadonlySet<PermissionKey>,
): T {
  if (!invoice.contractId || held.has("contracts.contract.view_sensitive")) return invoice;
  const lines = invoice.lines.map((line) => {
    const copy: Record<string, unknown> = { ...line };
    delete copy.unitCost;
    return copy;
  });
  const shown: Record<string, unknown> = { ...invoice, lines };
  delete shown.cost;
  return shown as unknown as T;
}

/**
 * Invoices as `GET /invoices` sends them to someone holding `held`: the contract-cost rule, then the
 * field strip. Typed as the stored shape, as the web receives them today (B1 Q4).
 */
export function invoicesAsSent<T extends Pick<Invoice, "contractId" | "lines">>(
  invoices: readonly T[],
  held: ReadonlySet<PermissionKey>,
): T[] {
  return invoices.map((invoice) => strippedFor(contractCostStripped(invoice, held), held));
}
