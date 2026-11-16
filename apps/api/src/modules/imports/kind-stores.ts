import type { ImportKind } from "@workspace/shared";
import { CUSTOMER_STORE } from "./customer-store";
import type { KindStore } from "./kind-store";
import { PRODUCT_STORE } from "./product-store";
import { SUPPLIER_STORE } from "./supplier-store";

/**
 * The kinds part 1 runs on the API (ADR 0057 S-1). Stock, opening invoices and bills, employees
 * and timesheets wait for their own parts and answer 404.
 */
export const KIND_STORES: Partial<Record<ImportKind, KindStore>> = {
  customers: CUSTOMER_STORE,
  addresses: CUSTOMER_STORE,
  suppliers: SUPPLIER_STORE,
  products: PRODUCT_STORE,
};
