import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { parse } from "../src/core/access/request-actor";
import { IMPORT_COMMIT, IMPORT_REQUEST, MAPPING_SAVE, parseKind } from "../src/modules/imports/import-input";
import { importFailure } from "../src/modules/imports/import-lock";

/** A valid dry-run body, with any part replaced. */
function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "customers",
    fileName: "customers.csv",
    table: { headers: ["Customer Name", "E-mail"], rows: [["Maple Row Builders", "orders@maplerow.example"]] },
    mapping: { name: "Customer Name", email: "E-mail", phone: null },
    ...overrides,
  };
}

/** A table of `rows` rows of `cells` cells under `cells` headers. */
function table(rows: number, cells = 2) {
  const headers = Array.from({ length: cells }, (_, i) => `Column ${i + 1}`);
  return { headers, rows: Array.from({ length: rows }, () => headers.map(() => "x")) };
}

/** The 400 message a parse gives, or null when it parses. */
function refusal(schema: Parameters<typeof parse>[0], input: unknown): string | null {
  try {
    parse(schema, input);
    return null;
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
    const answer = error.getResponse() as { code: string; message: string };
    expect(answer.code).toBe("invalid_request");
    return answer.message;
  }
}

describe("U-1 the dry run's body", () => {
  it("takes a valid body, up to 2,000 rows", () => {
    expect(refusal(IMPORT_REQUEST, body())).toBeNull();
    expect(refusal(IMPORT_REQUEST, body({ table: table(2000) }))).toBeNull();
  });

  it("refuses each size and shape problem with its words", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ table: table(2001) }, "Import at most 2,000 rows at a time; split the file."],
      [{ table: table(1, 61) }, "A file can have at most 60 columns."],
      [{ table: { headers: ["A"], rows: [Array.from({ length: 61 }, () => "x")] } }, "A row has more than 60 cells."],
      [
        { table: { headers: ["A"], rows: [["x".repeat(1001)]] } },
        "A cell is longer than 1,000 characters. Shorten it or leave that column out.",
      ],
      [{ table: { headers: ["A".repeat(201)], rows: [["x"]] } }, "A column header is longer than 200 characters."],
      [
        { table: { headers: ["Name", "Name"], rows: [["x", "y"]] } },
        "Two columns have the same header. Rename one and try again.",
      ],
      [{ table: { headers: [], rows: [["x"]] } }, "The file has no header row."],
      [{ table: { headers: ["A"], rows: [] } }, "The file has no rows under the header row."],
      [{ fileName: "   " }, "Name the file."],
      [{ fileName: "f".repeat(201) }, "A file name is at most 200 characters."],
      [{ kind: "payroll" }, "Choose what to import."],
    ];
    for (const [overrides, words] of cases) expect(refusal(IMPORT_REQUEST, body(overrides))).toBe(words);
  });

  it("trims the file name", () => {
    expect(parse(IMPORT_REQUEST, body({ fileName: "  customers.csv " })).fileName).toBe("customers.csv");
  });

  it("refuses more than 60 column choices", () => {
    const mapping = Object.fromEntries(Array.from({ length: 61 }, (_, i) => [`f${i}`, null]));
    expect(refusal(IMPORT_REQUEST, body({ mapping }))).toBe("Choose at most 60 columns.");
  });
});

describe("U-2 bodies name nothing else, never a company", () => {
  it("refuses a companyId and any other unknown field", () => {
    const words = "The request has a field this import doesn't take.";
    expect(refusal(IMPORT_REQUEST, body({ companyId: "0190f6a2-0000-7000-8000-000000000001" }))).toBe(words);
    expect(refusal(IMPORT_REQUEST, body({ table: { ...table(1), companyId: "x" } }))).toBe(words);
    expect(refusal(MAPPING_SAVE, { columns: {}, kind: "customers" })).toBe(words);
  });

  it("refuses a __proto__ column choice on the raw body", () => {
    const mapping = JSON.parse('{"__proto__": null, "name": "Customer Name"}') as unknown;
    expect(refusal(IMPORT_REQUEST, body({ mapping }))).toBe(
      "The column choices name a field this import doesn't have.",
    );
    expect(refusal(MAPPING_SAVE, { columns: mapping })).toBe(
      "The column choices name a field this import doesn't have.",
    );
  });
});

describe("U-3 an import carries the dry run's actions", () => {
  it("needs `expected` of c, u, s and e, one per row, at most 2,000", () => {
    const words = "Check the file again before importing.";
    expect(refusal(IMPORT_COMMIT, body())).toBe(words);
    expect(refusal(IMPORT_COMMIT, body({ expected: "" }))).toBe(words);
    expect(refusal(IMPORT_COMMIT, body({ expected: "x" }))).toBe(words);
    expect(refusal(IMPORT_COMMIT, body({ expected: "c".repeat(2001) }))).toBe(words);
    expect(refusal(IMPORT_COMMIT, body({ expected: "cuse" }))).toBeNull();
    expect(refusal(IMPORT_REQUEST, body({ expected: "c" }))).toBe("The request has a field this import doesn't take.");
  });
});

describe("U-4 database failures inside an import", () => {
  const dbError = (code: string) => Object.assign(new Error("db"), { code });
  const answer = (error: unknown) => (importFailure(error) as ConflictException).getResponse() as { code: string };

  it("turns lock waits into import_busy, also when wrapped", () => {
    for (const code of ["40P01", "40001", "55P03"]) {
      expect(importFailure(dbError(code))).toBeInstanceOf(ConflictException);
      expect(answer(dbError(code)).code).toBe("import_busy");
      expect(answer(new Error("query failed", { cause: dbError(code) })).code).toBe("import_busy");
    }
  });

  it("turns a unique clash into import_conflict", () => {
    expect(answer(dbError("23505")).code).toBe("import_conflict");
    expect(answer(new Error("query failed", { cause: dbError("23505") })).code).toBe("import_conflict");
  });

  it("passes refusals and every other error through unchanged", () => {
    const data = dbError("22P02");
    const other = new Error("boom");
    const refused = new ForbiddenException({ code: "forbidden", message: "No." });
    expect(importFailure(data)).toBe(data);
    expect(importFailure(other)).toBe(other);
    expect(importFailure(refused)).toBe(refused);
  });
});

describe("U-5 hidden control characters", () => {
  const words = "A column name or file name holds a hidden control character.";

  it("refuses NUL in a cell, BEL in a header, ESC in the file name and a newline in a column choice", () => {
    expect(refusal(IMPORT_REQUEST, body({ table: { headers: ["A"], rows: [["x\u0000y"]] } }))).toBe(
      "A cell holds a NUL character. Remove it and try again.",
    );
    expect(refusal(IMPORT_REQUEST, body({ table: { headers: ["A\u0007"], rows: [["x"]] } }))).toBe(words);
    expect(refusal(IMPORT_REQUEST, body({ fileName: "customers\u001b.csv" }))).toBe(words);
    expect(refusal(IMPORT_REQUEST, body({ mapping: { "name\n": "Customer Name" } }))).toBe(words);
    expect(refusal(IMPORT_REQUEST, body({ mapping: { name: "Customer\nName" } }))).toBe(words);
  });

  it("leaves other control characters in cells to the field rules", () => {
    expect(refusal(IMPORT_REQUEST, body({ table: { headers: ["A"], rows: [["line\nbreak\tand tab"]] } }))).toBeNull();
  });
});

describe("parseKind", () => {
  it("takes an import kind and refuses anything else", () => {
    expect(parseKind("suppliers")).toBe("suppliers");
    expect(parseKind("stock")).toBe("stock");
    expect(() => parseKind("__proto__")).toThrow(BadRequestException);
    expect(() => parseKind("Customers")).toThrow(BadRequestException);
  });
});
