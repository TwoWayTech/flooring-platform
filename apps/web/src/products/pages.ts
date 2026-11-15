import { featureOn, pagePatternScore, type Access, type PermissionKey, type ProductKey } from "@workspace/shared";
import { inThisBuild, PRODUCTS } from "./index";

/** A page or view and the permissions that open it; holding any one is enough. */
interface PageRule {
  /** Same patterns as feature screens: "/path", "/path?view=x" or "/path/*". */
  pattern: string;
  anyOf: PermissionKey[];
}

/**
 * Views and detail pages with their own view permission (spec A3). Top-level pages take the
 * permissions of their menu item, so the menu and the address bar always agree.
 */
const SUB_PAGES: PageRule[] = [
  { pattern: "/sales?view=quotes", anyOf: ["sales.quote.view"] },
  { pattern: "/sales/quotes/*", anyOf: ["sales.quote.view"] },
  { pattern: "/sales?view=invoices", anyOf: ["sales.invoice.view"] },
  { pattern: "/sales/invoices/*", anyOf: ["sales.invoice.view"] },
  { pattern: "/sales?view=customers", anyOf: ["customers.customer.view"] },
  { pattern: "/inventory?view=products", anyOf: ["inventory.product.view"] },
  { pattern: "/inventory?view=rolls", anyOf: ["inventory.roll.view"] },
  { pattern: "/inventory/rolls/*", anyOf: ["inventory.roll.view"] },
  { pattern: "/inventory?view=ready", anyOf: ["inventory.roll.cut"] },
  { pattern: "/inventory?view=transfers", anyOf: ["inventory.transfer.view"] },
  { pattern: "/purchasing?view=orders", anyOf: ["purchasing.order.view"] },
  { pattern: "/purchasing?view=bills", anyOf: ["purchasing.bill.view"] },
  { pattern: "/finance?view=payments", anyOf: ["sales.payment.approve", "purchasing.payment.approve"] },
  { pattern: "/finance?view=expenses", anyOf: ["finance.expense.view"] },
  { pattern: "/contracts/*", anyOf: ["contracts.contract.view"] },
  { pattern: "/hr/employees", anyOf: ["hr.employee.view"] },
  { pattern: "/hr/timesheets", anyOf: ["hr.timesheet.approve"] },
  { pattern: "/hr/time-off", anyOf: ["hr.pto.approve"] },
  { pattern: "/hr/commissions", anyOf: ["hr.commission.view"] },
  { pattern: "/hr/pay-periods", anyOf: ["hr.payroll.view"] },
  { pattern: "/my/*", anyOf: ["hr.portal.view"] },
];

/** Every page rule of a product: its menus and settings pages, then the views and detail pages. */
function rulesFor(product: ProductKey): PageRule[] {
  const config = PRODUCTS[product];
  const menus = [...config.menu, ...config.settings].map((item) => ({ pattern: item.href, anyOf: item.anyOf }));
  return [...menus, ...SUB_PAGES];
}

/**
 * The permissions a page needs (spec A3: every page maps to a view permission), from the most
 * specific matching rule, or null for pages without a rule (sign-in, the settings home, "/",
 * which sends people to their own first page).
 */
export function pagePermissions(product: ProductKey, href: string): PermissionKey[] | null {
  const [pathname = "", query = ""] = href.split("?");
  if (pathname === "/") return null;
  const view = new URLSearchParams(query).get("view");
  let best: { rule: PageRule; score: number } | null = null;
  for (const rule of rulesFor(product)) {
    const score = pagePatternScore(rule.pattern, pathname, view);
    if (score > (best?.score ?? 0)) best = { rule, score };
  }
  return best?.rule.anyOf ?? null;
}

/** Whether the access may open a page: it holds one of the page's permissions, or the page has none. */
export function canOpenPage(product: ProductKey, href: string, access: Access): boolean {
  const needed = pagePermissions(product, href);
  return !needed || needed.some((key) => access.permissions.has(key));
}

/** The pages of a product whose feature is on and that exist in this build, for the effective access preview. */
export function pageList(product: ProductKey): { label: string; href: string; anyOf: PermissionKey[] }[] {
  const config = PRODUCTS[product];
  return [...config.menu, ...config.settings]
    .filter((item) => inThisBuild(item) && item.features.some((key) => featureOn(key)))
    .map(({ label, href, anyOf }) => ({ label, href, anyOf }));
}
