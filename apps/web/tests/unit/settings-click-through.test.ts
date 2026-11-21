import { afterEach, describe, expect, it } from "vitest";
import { defaultNumberSettings, roleTemplate, type Access, type AuditEntry } from "@workspace/shared";
import { accountRoleLine } from "@/components/shell/user-menu";
import { auditChangesText } from "@/features/settings/audit-change-list";
import { isWideSettingsPage } from "@/features/settings/settings-frame";
import { featureInBuild } from "@/lib/demo-tools";
import { leavingHref, type LeaveClick } from "@/lib/leave-guard";
import { productChoice, productCookie } from "@/lib/product";
import { PRODUCTS, visibleItems } from "@/products";
import { pageList } from "@/products/pages";

const before = process.env.NEXT_PUBLIC_DATA_SOURCE;
afterEach(() => {
  if (before === undefined) delete process.env.NEXT_PUBLIC_DATA_SOURCE;
  else process.env.NEXT_PUBLIC_DATA_SOURCE = before;
});

const owner: Access = (() => {
  const template = roleTemplate("owner");
  return { permissions: new Set(template.permissions), dataScope: template.dataScope, isOwner: true };
})();

describe("click-through #69: no demo-only controls in the real product", () => {
  it("shows Reset demo data, the presenter guide and Connect a database in the demo only", () => {
    process.env.NEXT_PUBLIC_DATA_SOURCE = "demo";
    expect(featureInBuild("demo.reset")).toBe(true);
    expect(featureInBuild("shell.presenter-guide")).toBe(true);
    expect(visibleItems(PRODUCTS.flooring.settings, owner).map((i) => i.href)).toContain("/settings/database");

    process.env.NEXT_PUBLIC_DATA_SOURCE = "api";
    expect(featureInBuild("demo.reset")).toBe(false);
    expect(featureInBuild("shell.presenter-guide")).toBe(false);
    expect(featureInBuild("shell.network-simulation")).toBe(false);
    expect(featureInBuild("settings.import")).toBe(true);
    expect(visibleItems(PRODUCTS.flooring.settings, owner).map((i) => i.href)).not.toContain("/settings/database");
    expect(pageList("flooring").map((p) => p.href)).not.toContain("/settings/database");
  });

  it("names the product cookie neutrally in api mode and lets plain /login fall back to the host", () => {
    expect(productCookie(true)).toBe("demo_product");
    expect(productCookie(false)).toBe("product_choice");
    const local = { host: "localhost:3000", cookieProduct: "hr" } as const;
    // The demo keeps remembering ?product=hr.
    expect(productChoice({ ...local, demo: true, pathname: "/login", queryProduct: null })).toEqual({
      product: "hr",
      remember: false,
    });
    // The real product: plain /login is the Flooring Suite again, and that choice is recorded.
    expect(productChoice({ ...local, demo: false, pathname: "/login", queryProduct: null })).toEqual({
      product: "flooring",
      remember: true,
    });
    expect(productChoice({ ...local, demo: false, pathname: "/login", queryProduct: "hr" }).product).toBe("hr");
    // After signing in on HR, the app's pages keep it.
    expect(productChoice({ ...local, demo: false, pathname: "/", queryProduct: null })).toEqual({
      product: "hr",
      remember: false,
    });
    // A host always wins.
    expect(productChoice({ demo: false, host: "app.example", pathname: "/login", queryProduct: "hr" }).product).toBe(
      "flooring",
    );
  });
});

describe("click-through #70: the account menu names a role once", () => {
  it("drops a job title that is also a role's name", () => {
    expect(accountRoleLine("Owner", ["Owner"])).toBe("Owner");
    expect(accountRoleLine("owner", ["Owner", "Accountant"])).toBe("owner, Accountant");
    expect(accountRoleLine("Store manager", ["Manager"])).toBe("Store manager, Manager");
    expect(accountRoleLine("", ["Sales"])).toBe("Sales");
  });
});

describe("click-through #56: leaving a page with unsaved changes", () => {
  const here = { origin: "http://localhost:3000", pathname: "/settings/branding", search: "" };
  const click = (href: string, over: Partial<LeaveClick> = {}): LeaveClick => ({
    button: 0,
    modifier: false,
    defaultPrevented: false,
    link: { href, target: "", download: false },
    ...over,
  });

  it("asks for a link to another page of the app", () => {
    expect(leavingHref(click("http://localhost:3000/dashboard"), here)).toBe("/dashboard");
    expect(leavingHref(click("http://localhost:3000/settings/roles?x=1#a"), here)).toBe("/settings/roles?x=1#a");
  });

  it("lets a new tab, a download, another site or this same page through", () => {
    expect(leavingHref(click("http://localhost:3000/dashboard", { modifier: true }), here)).toBeNull();
    expect(leavingHref(click("http://localhost:3000/dashboard", { button: 1 }), here)).toBeNull();
    expect(leavingHref({ ...click(""), link: null }, here)).toBeNull();
    const download = { href: "http://localhost:3000/x.csv", target: "", download: true };
    expect(leavingHref(click("", { link: download }), here)).toBeNull();
    const blank = { href: "http://localhost:3000/dashboard", target: "_blank", download: false };
    expect(leavingHref(click("", { link: blank }), here)).toBeNull();
    expect(leavingHref(click("https://example.com/"), here)).toBeNull();
    expect(leavingHref(click("http://localhost:3000/settings/branding#top"), here)).toBeNull();
  });
});

describe("click-through #53: Security roles gets the width", () => {
  it("puts the settings menu above the roles page", () => {
    expect(isWideSettingsPage("/settings/roles")).toBe(true);
    expect(isWideSettingsPage("/settings/branding")).toBe(false);
    expect(isWideSettingsPage("/settings/rolesx")).toBe(false);
  });
});

describe("click-through #58: the audit log's readable text", () => {
  const entry = (over: Partial<AuditEntry>): AuditEntry => ({
    id: "a1",
    at: "2026-11-21T09:00",
    actorName: "Dana Whitfield",
    actorRole: "Owner",
    category: "data",
    action: "Changed customer",
    target: "Avery Collins",
    before: null,
    after: null,
    ...over,
  });
  const id = "90f151cf-1c2d-7e3f-8a4b-5c6d7e8f9a0b";

  it("reads field: old → new, ids by name and money in the company's format", () => {
    const text = auditChangesText(
      entry({
        before: JSON.stringify({ locationId: id, creditLimit: "1000.00" }),
        after: JSON.stringify({ locationId: "01936b2a-0000-7000-8000-000000000001", creditLimit: "2500" }),
        names: { [id]: "Denver Central" },
      }),
      defaultNumberSettings(),
    );
    expect(text).toBe("Location: Denver Central → Record 01936b2a; Credit limit: $1,000.00 → $2,500.00");
  });

  it("reads a new customer's fields, and plain text as it was written", () => {
    const created = entry({ after: JSON.stringify({ name: "Avery Collins", terms: "net_30" }) });
    expect(auditChangesText(created, defaultNumberSettings())).toBe("Name: Avery Collins; Terms: Net 30");
    expect(auditChangesText(entry({ before: "reserved", after: "issued 100" }), defaultNumberSettings())).toBe(
      "reserved → issued 100",
    );
  });
});
