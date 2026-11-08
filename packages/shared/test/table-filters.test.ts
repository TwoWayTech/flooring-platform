import { describe, expect, it } from "vitest";
import { filteredHref, inferFilterKind, matchesFilter, viewFromParams, viewToParams, type TableView } from "../src";

describe("table filters (spec A2)", () => {
  it("picks a filter from the column's values", () => {
    expect(inferFilterKind(["12.50", "3"], true)).toBe("range");
    expect(inferFilterKind(["2026-01-04", "2026-02-01T09:00", null], false)).toBe("date");
    expect(inferFilterKind(["Paid", "Open", "Paid", "Overdue"], false)).toBe("select");
    expect(inferFilterKind(["Ana", "Ben", "Cy"], false)).toBe("text");
  });

  it("matches text, values, number ranges and date ranges", () => {
    expect(matchesFilter("Harbor Oak", { kind: "text", text: "oak" })).toBe(true);
    expect(matchesFilter("Paid", { kind: "select", values: ["Open", "Overdue"] })).toBe(false);
    expect(matchesFilter(null, { kind: "select", values: [""] })).toBe(true);
    expect(matchesFilter("99.995", { kind: "range", min: "100", max: "" })).toBe(false);
    expect(matchesFilter("100.00", { kind: "range", min: "100", max: "500" })).toBe(true);
    expect(matchesFilter(null, { kind: "range", min: "1", max: "" })).toBe(false);
    expect(matchesFilter("2026-03-31T17:00", { kind: "date", from: "2026-03-01", to: "2026-03-31" })).toBe(true);
    expect(matchesFilter("2026-04-01", { kind: "date", from: "", to: "2026-03-31" })).toBe(false);
  });

  it("treats an empty filter as no filter", () => {
    expect(matchesFilter(null, { kind: "range", min: "", max: "" })).toBe(true);
    expect(matchesFilter("x", { kind: "select", values: [] })).toBe(true);
  });

  it("writes a view to the URL and reads it back under the table's own prefix", () => {
    const view: TableView = {
      search: "smith",
      sort: { id: "issued", desc: true },
      filters: {
        state: { kind: "select", values: ["Overdue", "Partly paid"] },
        total: { kind: "range", min: "100", max: "" },
        empty: { kind: "text", text: "" },
      },
    };
    const params = viewToParams("sales-invoices", view);
    expect(params).toEqual([
      ["sales-invoices.q", "smith"],
      ["sales-invoices.sort", "-issued"],
      ["sales-invoices.f.state", "Overdue|Partly paid"],
      ["sales-invoices.f.total", "100.."],
    ]);
    const back = viewFromParams("sales-invoices", [...params, ["other.q", "x"]], { state: "select", total: "range" });
    expect(back).toEqual({ ...view, filters: { state: view.filters.state, total: view.filters.total } });
    expect(viewFromParams("sales-quotes", params, {})).toBeNull();
  });

  it("builds links that open a table already filtered", () => {
    expect(filteredHref("/sales?view=invoices", "sales-invoices", "state", ["Overdue"])).toBe(
      "/sales?view=invoices&sales-invoices.f.state=Overdue",
    );
  });
});
