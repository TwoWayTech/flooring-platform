import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "@/components/data-table/csv";

describe("CSV cells never run as spreadsheet formulas (trial balance review round 2)", () => {
  it("prefixes ' to text that starts like a formula", () => {
    for (const text of ['=HYPERLINK("x")', "+1 303 555 0142", "-", "-cmd", "@SUM(A1)"])
      expect(csvCell(text)).toBe(text.includes('"') ? `"'${text.replace(/"/g, '""')}"` : `'${text}`);
  });

  it("quotes a cell that starts with a tab or carriage return, or holds one", () => {
    expect(csvCell("\tcmd")).toBe("'\tcmd");
    expect(csvCell("\rcmd")).toBe('"\'\rcmd"');
    expect(csvCell("a\rb")).toBe('"a\rb"');
  });

  it("keeps plain numbers, negative ones included, and ordinary text as they are", () => {
    for (const value of ["-12.50", "0.00", "300", "-7", "Maple Row Builders", "a=b", ""])
      expect(csvCell(value)).toBe(value);
    expect(csvCell(-3)).toBe("-3");
    expect(csvCell(null)).toBe("");
    // An exponent is not a plain number here; the prefix is harmless.
    expect(csvCell("-1e-7")).toBe("'-1e-7");
  });

  it("applies to every toCsv export", () => {
    const text = toCsv(
      [{ name: "=1+1", amount: "-5.00" }],
      [
        { id: "name", header: "Name", value: (r: { name: string }) => r.name },
        { id: "amount", header: "Amount", value: (r: { amount: string }) => r.amount },
      ],
    );
    expect(text).toBe("Name,Amount\n'=1+1,-5.00");
  });
});
