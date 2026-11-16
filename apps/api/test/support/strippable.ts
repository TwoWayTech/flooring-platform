import type { PermissionKey } from "@workspace/shared";

/*
 * The reviewed list of fields that must never reach a viewer without their key, and the JSON walk
 * that finds them in an answer (whole-product check, ADR 0058). It imports nothing from the API's
 * source, so the web's api-mode check specs judge answers by the same reviewed list as the route
 * matrix (PM-7) does.
 */

/**
 * The response fields CLAUDE.md rule 5 keeps from roles without the key (cost, margin, pay rate and
 * credit limit, and their kin), each with the key that reveals it, written out here as reviewed
 * literals. The route matrix (PM-7) judges leaks by this list as well as by the shared
 * SENSITIVE_FIELDS map the API strips with, so taking a name out of that map (mutation M4) fails
 * here instead of changing the judge and the defendant together.
 */
export const MUST_STRIP: Readonly<Record<string, PermissionKey>> = {
  cost: "inventory.product.view_sensitive",
  unitCost: "inventory.product.view_sensitive",
  averageCost: "inventory.product.view_sensitive",
  landedCost: "inventory.product.view_sensitive",
  costPerSqFt: "inventory.product.view_sensitive",
  productCost: "inventory.product.view_sensitive",
  margin: "sales.margin.view_sensitive",
  marginPct: "sales.margin.view_sensitive",
  grossMargin: "sales.margin.view_sensitive",
  grossMarginPct: "sales.margin.view_sensitive",
  jobMargin: "installation.job.view_sensitive",
  jobMarginPct: "installation.job.view_sensitive",
  jobCost: "installation.job.view_sensitive",
  laborCost: "installation.job.view_sensitive",
  payRate: "hr.employee.view_sensitive",
  hourlyRate: "hr.employee.view_sensitive",
  baseRate: "hr.employee.view_sensitive",
  regularRate: "hr.employee.view_sensitive",
  salary: "hr.employee.view_sensitive",
  salaryAmount: "hr.employee.view_sensitive",
  creditLimit: "customers.customer.view_sensitive",
  estimatedCost: "contracts.contract.view_sensitive",
};

/** One place in a JSON body: the field it sits under, where it is, and its value. */
export interface JsonNode {
  /** The object field, or for an array item the array's field; undefined at the root. */
  field: string | undefined;
  /** `$.items[3].lines[0].unitCost`, for messages. */
  path: string;
  value: unknown;
  /** Whether the node is an array item rather than an object field. */
  item: boolean;
}

/** Every node of a JSON body, depth first. Array items carry their array's field name. */
export function* jsonNodes(value: unknown, field?: string, path = "$", item = false): Generator<JsonNode> {
  yield { field, path, value, item };
  if (Array.isArray(value)) {
    for (const [index, inner] of value.entries()) yield* jsonNodes(inner, field, `${path}[${index}]`, true);
  } else if (typeof value === "object" && value !== null) {
    for (const [key, inner] of Object.entries(value)) yield* jsonNodes(inner, key, `${path}.${key}`, false);
  }
}

/** A snake_case field as its camelCase name (`unit_cost` → `unitCost`), as the API's stripping reads it. */
export function camelName(field: string): string {
  return field.replace(/_([a-z0-9])/g, (_match, letter: string) => letter.toUpperCase());
}

/** A record's own value for a name; never one inherited from Object.prototype (`constructor`, `toString`). */
export function own<T>(record: Readonly<Record<string, T>> | undefined, name: string): T | undefined {
  return record !== undefined && Object.hasOwn(record, name) ? record[name] : undefined;
}

/** The MUST_STRIP names a body shows anywhere (as sent or in camelCase), for the "exercised" record. */
export function strippableNames(body: unknown): Set<string> {
  const names = new Set<string>();
  for (const node of jsonNodes(body)) {
    if (node.item || node.field === undefined) continue;
    for (const name of [node.field, camelName(node.field)]) if (own(MUST_STRIP, name)) names.add(name);
  }
  return names;
}
