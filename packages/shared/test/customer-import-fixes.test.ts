import { describe, expect, it } from "vitest";
import {
  autoMap,
  CUSTOMER_FIELD_MESSAGES,
  emptyImportWorld,
  FIX_ROWS_PROBLEMS,
  fixRowsTable,
  IMPORT_HANDLERS,
  importKind,
  PAYMENT_TERMS,
  planImport,
  readCell,
  zipProblem,
  type ImportTable,
  type ImportUser,
  type PlanContext,
} from "../src";

const OWNER: ImportUser = { id: "u-owner", name: "Riley Owner", email: "owner@summit.example", status: "active" };

/** An empty company with the Owner as its one user. */
function context(): PlanContext {
  let n = 0;
  return {
    world: emptyImportWorld({ users: [OWNER] }),
    companyId: "summit",
    today: "2026-11-21",
    now: "2026-11-21T09:00",
    actorId: OWNER.id,
    batch: { id: "imp-1", number: "IMP-1001" },
    newId: (kind) => `new-${kind}-${++n}`,
    workweekStartDay: 1,
  };
}

/** The customers kind's dry run of a file, its columns matched as the wizard matches them. */
function dryRun(table: ImportTable) {
  const mapping = autoMap(importKind("customers"), table.headers);
  return planImport(IMPORT_HANDLERS.customers, { kind: "customers", fileName: "c.csv", table, mapping }, context());
}

const field = (key: string) => importKind("customers").fields.find((f) => f.key === key)!;

describe("click-through #51: every bad cell of a customer row is flagged, in the customer form's words", () => {
  it("flags a bad ZIP and unknown terms even on a row with another bad cell", () => {
    const result = dryRun({
      headers: ["Name", "Email", "Payment terms", "Street", "City", "State", "ZIP"],
      rows: [["Bad Row Supply", "not-an-email", "Net 60", "1 Main St", "Denver", "CO", "ABCDE"]],
    });
    expect(result.rows[0]!.action).toBe("error");
    expect(result.rows[0]!.problems).toEqual([
      { field: "email", message: "“not-an-email” is not an email address." },
      { field: "terms", message: CUSTOMER_FIELD_MESSAGES.terms },
      { field: "zip", message: CUSTOMER_FIELD_MESSAGES.zip },
    ]);
  });

  it("uses the same words as the customer form and lists the allowed terms", () => {
    expect(zipProblem("ABCDE")).toBe("Enter a ZIP such as 80202 or 80202-1234.");
    expect(CUSTOMER_FIELD_MESSAGES.terms).toBe("Use one of the payment terms: Due on receipt, Net 15, Net 30, Net 45.");
  });

  it("takes a 5-digit or ZIP+4 code and every allowed term, Net 45 included", () => {
    for (const zip of ["80202", "80202-1234", " 80302 "]) expect(zipProblem(zip), zip).toBeNull();
    for (const zip of ["8020", "802021", "80202-12", "ABCDE", ""]) expect(zipProblem(zip), zip).not.toBeNull();
    expect(PAYMENT_TERMS).toEqual(["due_on_receipt", "net_15", "net_30", "net_45"]);
    for (const label of ["Due on receipt", "Net 15", "Net 30", "Net 45", "net_45"]) {
      expect(readCell(field("terms"), label), label).not.toHaveProperty("error");
    }
    expect(readCell(field("zip"), "80202-1234")).toEqual({ value: "80202-1234" });
    expect(readCell(field("zip"), "")).toEqual({ value: null });
  });
});

describe("click-through #52: the rows to fix, in the file's own columns", () => {
  it("writes only the failed rows, under the original headers and as typed, with a Problems column", () => {
    const table: ImportTable = {
      headers: ["Customer Name", "E-mail", "Payment terms", "Notes"],
      rows: [
        ["Avery Collins", "avery@mail.example", "Net 30", "keep"],
        ["", "", "", ""],
        ["Bad Row Supply", "not-an-email", "Net 60"],
      ],
    };
    const result = dryRun(table);
    expect(result.rows.map((row) => [row.line, row.action])).toEqual([
      [2, "create"],
      [4, "error"],
    ]);
    expect(fixRowsTable(importKind("customers"), table, result)).toEqual([
      ["Customer Name", "E-mail", "Payment terms", "Notes", FIX_ROWS_PROBLEMS],
      [
        "Bad Row Supply",
        "not-an-email",
        "Net 60",
        "",
        `Email: “not-an-email” is not an email address. Payment terms: ${CUSTOMER_FIELD_MESSAGES.terms}`,
      ],
    ]);
  });

  it("is just the header row when nothing failed", () => {
    const table: ImportTable = { headers: ["Name", "Email"], rows: [["Avery Collins", "avery@mail.example"]] };
    expect(fixRowsTable(importKind("customers"), table, dryRun(table))).toEqual([["Name", "Email", FIX_ROWS_PROBLEMS]]);
  });
});
