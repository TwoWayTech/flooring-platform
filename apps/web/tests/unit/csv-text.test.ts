import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import { csvText } from "@/features/import/csv-text";

const BOM = "﻿";

/** The cells of CSV text as a spreadsheet would read them, without the byte-order mark. */
function cellsOf(text: string): string[][] {
  return Papa.parse<string[]>(text.slice(BOM.length)).data;
}

describe("the import wizard's CSV text (ADR 0057 S-15)", () => {
  it("W-7: prefixes ' to every cell that starts like a formula, leaves the others and starts with the BOM", () => {
    const risky = ['=HYPERLINK("x")', "+1+2", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"];
    const plain = ["Maple Row Builders", "orders@maplerow.example", "a=b", "(303) 555-0142", "25000.00", ""];
    const text = csvText([["Value"], ...risky.map((cell) => [cell]), ...plain.map((cell) => [cell])]);
    expect(text.startsWith(BOM)).toBe(true);
    const cells = cellsOf(text).map((row) => row[0]);
    expect(cells.slice(1, 1 + risky.length)).toEqual(risky.map((cell) => `'${cell}`));
    expect(cells.slice(1 + risky.length)).toEqual(plain);
  });

  it("escapes a formula cell that holds a line break, which Papa Parse's own pattern misses", () => {
    const cell = '=HYPERLINK("http://x.example")\nmore';
    expect(Papa.unparse([[cell]], { escapeFormulae: true })).not.toContain("'=");
    const text = csvText([["Value"], [cell]]);
    expect(cellsOf(text)[1]).toEqual([`'${cell}`]);
    expect(text.split(/\r\n|\n/).some((line) => line.startsWith("="))).toBe(false);
  });

  it("writes cells as they are when asked to, for files other software reads", () => {
    const text = csvText([["Amount"], ["-12.50"], ["=1+1"]], { escapeFormulas: false });
    expect(text.startsWith(BOM)).toBe(true);
    expect(cellsOf(text)).toEqual([["Amount"], ["-12.50"], ["=1+1"]]);
  });
});
