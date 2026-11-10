import type { ModuleKey } from "../../products";
import type { ImportKind, ImportKindDef } from "../types";
import type { KindHandler } from "../plan";
import { ADDRESSES, CUSTOMERS } from "./customers";
import { EMPLOYEES } from "./employees";
import { BILLS, INVOICES } from "./opening";
import { PRODUCTS } from "./products";
import { STOCK } from "./stock";
import { SUPPLIERS } from "./suppliers";
import { TIMESHEETS } from "./timesheets";

/**
 * Every import kind in the order the wizard offers them (spec G1 step 1): the order data is
 * usually brought over in, since products need suppliers, stock needs products, and opening
 * invoices need customers.
 */
export const IMPORT_HANDLERS: Record<ImportKind, KindHandler> = {
  customers: CUSTOMERS,
  addresses: ADDRESSES,
  suppliers: SUPPLIERS,
  products: PRODUCTS,
  stock: STOCK,
  invoices: INVOICES,
  bills: BILLS,
  employees: EMPLOYEES,
  timesheets: TIMESHEETS,
};

/** The definition of one import kind: its label, what it matches on and its columns. */
export const importKind = (kind: ImportKind): ImportKindDef => IMPORT_HANDLERS[kind].def;

/** The kinds a company can import: those whose module it has switched on. */
export function importKindsFor(modules: readonly ModuleKey[]): ImportKind[] {
  return (Object.keys(IMPORT_HANDLERS) as ImportKind[]).filter((k) => modules.includes(IMPORT_HANDLERS[k].def.module));
}
