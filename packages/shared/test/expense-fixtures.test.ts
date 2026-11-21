import { describe, expect, it } from "vitest";
import { loadFixtures } from "./report-fixtures";

describe("seeded expenses (click-through #41)", () => {
  it.each(["summit", "keystone"] as const)("%s: each vendor's expenses sit in that vendor's category", (name) => {
    const f = loadFixtures(name);
    const vendor = (id: string | null) => f.suppliers.find((s) => s.id === id)?.name;
    const peakline = f.expenses.filter((e) => vendor(e.supplierId) === "Peakline Internet and Phone");
    expect(peakline.length).toBeGreaterThan(0);
    expect(new Set(peakline.map((e) => e.category))).toEqual(new Set(["internet_phone"]));
    expect(f.recurringExpenses.filter((r) => r.category === "internet_phone").map((r) => vendor(r.supplierId))).toEqual(
      ["Peakline Internet and Phone"],
    );
  });

  it.each(["summit", "keystone"] as const)("%s: only payroll and drafts are seeded without a vendor", (name) => {
    const f = loadFixtures(name);
    const without = f.expenses.filter((e) => !e.supplierId && e.category !== "payroll");
    expect(without.every((e) => e.status === "draft")).toBe(true);
    expect(f.expenses.filter((e) => e.category === "maintenance").every((e) => e.supplierId)).toBe(true);
  });
});
