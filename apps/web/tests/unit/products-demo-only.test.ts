import { afterEach, describe, expect, it } from "vitest";
import { roleTemplate, type Access } from "@workspace/shared";
import { PRODUCTS, visibleItems } from "@/products";
import { pageList } from "@/products/pages";

const before = process.env.NEXT_PUBLIC_DATA_SOURCE;

/** The Owner's access: every settings page they could open. */
const owner: Access = (() => {
  const template = roleTemplate("owner");
  return { permissions: new Set(template.permissions), dataScope: template.dataScope, isOwner: true };
})();

const hrefs = (items: readonly { href: string }[]) => items.map((item) => item.href);

describe("demo-only pages (ADR 0051 part 3)", () => {
  afterEach(() => {
    if (before === undefined) delete process.env.NEXT_PUBLIC_DATA_SOURCE;
    else process.env.NEXT_PUBLIC_DATA_SOURCE = before;
  });

  it("hides Settings → Meetings from menus, search and the access preview in api mode only", () => {
    const { flooring, hr } = PRODUCTS;
    process.env.NEXT_PUBLIC_DATA_SOURCE = "demo";
    expect(hrefs(visibleItems(flooring.settings, owner))).toContain("/settings/meetings");
    expect(hrefs(visibleItems([...flooring.menu, ...flooring.settings], owner))).toContain("/settings/meetings");
    expect(hrefs(pageList("flooring"))).toContain("/settings/meetings");

    process.env.NEXT_PUBLIC_DATA_SOURCE = "api";
    for (const product of [flooring, hr]) {
      // The sidebar, settings home and nav, and settings search all read `visibleItems`; the palette reads menus and settings.
      expect(hrefs(visibleItems(product.settings, owner))).not.toContain("/settings/meetings");
      expect(hrefs(visibleItems([...product.menu, ...product.settings], owner))).not.toContain("/settings/meetings");
      expect(hrefs(pageList(product.key))).not.toContain("/settings/meetings");
    }
    // Every other settings page stays.
    expect(hrefs(visibleItems(flooring.settings, owner))).toContain("/settings/outbox");
  });
});
