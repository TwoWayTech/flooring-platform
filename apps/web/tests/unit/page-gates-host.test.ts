import { describe, expect, it } from "vitest";
import { PRODUCT_ROLES } from "@workspace/shared";
import { canOpenPage } from "@/products/pages";
import { trialAccess } from "./coverage-scan/page-rules";

/** Flooring Suite pages no HR Suite rule names (whole-product check finding F-p). */
const FLOORING_ONLY = [
  "/sales",
  "/sales/quotes/new",
  "/inventory",
  "/purchasing",
  "/finance",
  "/contracts",
  "/reports",
  "/installation",
];

/** Pages no product's rule names, open to every member on either host (sign-in, home, settings home). */
const NO_RULE_ANYWHERE = ["/", "/settings", "/outbox", "/account/security"];

/**
 * A page belongs to the products whose menus or view rules name it: the HR Suite host refuses a
 * Flooring Suite page for every role, the Owner included, while pages no product names stay open
 * (finding F-p, 2026-11-20).
 */
describe("page gates by host (F-p)", () => {
  it("refuses every Flooring Suite page on the HR Suite host, for every role", () => {
    for (const role of PRODUCT_ROLES.hr) {
      for (const page of FLOORING_ONLY) {
        expect({ role, page, opens: canOpenPage("hr", page, trialAccess(role, "hr")) }).toEqual({
          role,
          page,
          opens: false,
        });
      }
    }
  });

  it("still opens those pages on the Flooring Suite host for the Owner", () => {
    for (const page of FLOORING_ONLY) {
      expect({ page, opens: canOpenPage("flooring", page, trialAccess("owner", "flooring")) }).toEqual({
        page,
        opens: true,
      });
    }
  });

  it("keeps the pages no product names open on both hosts", () => {
    for (const product of ["flooring", "hr"] as const) {
      for (const role of PRODUCT_ROLES[product]) {
        for (const page of NO_RULE_ANYWHERE) {
          expect(canOpenPage(product, page, trialAccess(role, product)), `${product} ${role} ${page}`).toBe(true);
        }
      }
    }
  });
});
