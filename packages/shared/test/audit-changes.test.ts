import { describe, expect, it } from "vitest";
import { auditChanges, auditLabel, stockIssueAction } from "../src";

const LOCATION = "90f151cf-1c2d-7e3f-8a4b-5c6d7e8f9a0b";
const OTHER = "01936b2a-0000-7000-8000-000000000001";

describe("click-through #58: audit before and after as readable lines", () => {
  it("labels fields from their names", () => {
    expect(auditLabel("locationId")).toBe("Location");
    expect(auditLabel("salesRepId")).toBe("Sales rep");
    expect(auditLabel("roleIds")).toBe("Roles");
    expect(auditLabel("depositPct")).toBe("Deposit %");
    expect(auditLabel("address.city")).toBe("Address city");
    expect(auditLabel("credit_limit")).toBe("Credit limit");
    expect(auditLabel("")).toBe("Value");
  });

  it("lists only what changed, ids named where the entry has the name, numbers by kind", () => {
    const before = JSON.stringify({ locationId: LOCATION, creditLimit: "1000.00", note: "same", isDefault: false });
    const after = JSON.stringify({ locationId: OTHER, creditLimit: "2500.00", note: "same", isDefault: true });
    expect(auditChanges(before, after, { [LOCATION]: "Denver Central" })).toEqual([
      {
        key: "locationId",
        label: "Location",
        before: { kind: "record", id: LOCATION, name: "Denver Central" },
        after: { kind: "record", id: OTHER, name: null },
      },
      {
        key: "creditLimit",
        label: "Credit limit",
        before: { kind: "number", value: "1000.00", number: "money" },
        after: { kind: "number", value: "2500.00", number: "money" },
      },
      {
        key: "isDefault",
        label: "Is default",
        before: { kind: "text", text: "No" },
        after: { kind: "text", text: "Yes" },
      },
    ]);
  });

  it("shows every field of a new record, stored words made readable", () => {
    const after = JSON.stringify({ name: "Avery Collins", type: "homeowner", terms: "due_on_receipt", email: "" });
    expect(auditChanges(null, after)).toEqual([
      { key: "name", label: "Name", before: null, after: { kind: "text", text: "Avery Collins" } },
      { key: "type", label: "Type", before: null, after: { kind: "text", text: "homeowner" } },
      { key: "terms", label: "Terms", before: null, after: { kind: "text", text: "Due on receipt" } },
      { key: "email", label: "Email", before: null, after: { kind: "none" } },
    ]);
  });

  it("opens nested objects, summarises lists of objects and names lists of ids", () => {
    const after = JSON.stringify({
      address: { city: "Denver", zip: "80202" },
      lines: [{ a: 1 }, { a: 2 }],
      roleIds: [LOCATION, OTHER],
      remainingLengthFt: "70.000",
    });
    const changes = auditChanges(null, after, { [LOCATION]: "Sales" });
    expect(changes.map((c) => [c.label, c.after])).toEqual([
      ["Address city", { kind: "text", text: "Denver" }],
      ["Address zip", { kind: "text", text: "80202" }],
      ["Lines", { kind: "text", text: "2 items" }],
      ["Roles", { kind: "text", text: "Sales, Record 01936b2a" }],
      ["Remaining length ft", { kind: "number", value: "70.000", number: "quantity" }],
    ]);
  });

  it("keeps plain text as one value, and an empty entry as no lines", () => {
    expect(auditChanges("reserved", "cut 30 ft from NM-1042")).toEqual([
      {
        key: "",
        label: "Value",
        before: { kind: "text", text: "reserved" },
        after: { kind: "text", text: "cut 30 ft from NM-1042" },
      },
    ]);
    expect(auditChanges(null, null)).toEqual([]);
  });

  it("names a roll cut by its roll and invoice, and keeps boxed goods as issued stock", () => {
    expect(stockIssueAction(true, "INV-1220", "NM-1042")).toBe("Cut roll NM-1042 for INV-1220");
    expect(stockIssueAction(false, "INV-1220", "NM-1042")).toBe("Cut roll NM-1042 for INV-1220 before payment");
    expect(stockIssueAction(true, "INV-1220", null)).toBe("Issued stock");
    expect(stockIssueAction(false, "INV-1220", null)).toBe("Issued stock before payment");
  });
});
