import { describe, expect, it } from "vitest";
import {
  IMPORT_LIMITS,
  IMPORT_TOO_LARGE,
  IMPORT_WORDS,
  importKind,
  mappedTable,
  type ImportBatchSummary,
  type ImportRequest,
} from "@workspace/shared";
import { ApiError } from "@/lib/api/errors";
import { importBody } from "@/lib/api/http/import-body";
import { HttpApiError } from "@/lib/api/http/transport";
import { fakeApi } from "./fake-api";

/** The error a call rejects with, or null when it resolved. */
async function failureOf(call: Promise<unknown>): Promise<Error | null> {
  try {
    await call;
    return null;
  } catch (failure) {
    if (failure instanceof Error) return failure;
    throw failure;
  }
}

/**
 * A customers file as the wizard holds it: the chosen columns out of field order, one column the
 * person left unchosen (Notes) and a header row of the file's own names.
 */
function customersRequest(over: Partial<ImportRequest> = {}): ImportRequest {
  return {
    kind: "customers",
    fileName: "customers.csv",
    table: {
      headers: ["E-mail", "Notes", "Customer Name", "Account Number"],
      rows: [
        ["orders@maplerow.example", "Pays late; call first", "Maple Row Builders", "CUST-9001"],
        ["avery.collins@mail.example", "", "Avery Collins", "CUST-9002"],
        ["", "only a note", "", ""],
      ],
    },
    mapping: { external_id: "Account Number", name: "Customer Name", email: "E-mail", phone: null },
    ...over,
  };
}

/** The customers kind's mapping as the API takes it: every field, chosen ones with their header. */
const FULL_MAPPING = {
  external_id: "Account Number",
  name: "Customer Name",
  type: null,
  contact_name: null,
  email: "E-mail",
  phone: null,
  terms: null,
  credit_limit: null,
  sales_rep: null,
  street: null,
  city: null,
  state: null,
  zip: null,
};

const BATCH_ID = "0195f3a2-7b1c-7d4e-8f00-00000000ee01";

const SUMMARY: ImportBatchSummary = {
  id: BATCH_ID,
  number: "IMP-1001",
  kind: "customers",
  fileName: "customers.csv",
  at: "2026-11-16T08:00:00.000Z",
  byName: "Luis Ortega",
  mapping: FULL_MAPPING,
  counts: { create: 2, update: 0, skip: 0, error: 0 },
  undoneAt: null,
  undoneBy: null,
};

describe("data import on the API, part 1 (ADR 0057)", () => {
  it("W-1: reads the overview from GET /imports, and nothing it sends names the company", async () => {
    const overview = { kinds: ["customers"], mappings: [], batches: [SUMMARY] };
    const { client, sent } = fakeApi({ "GET /imports": { status: 200, body: overview } });
    expect(await client.importOverview("summit")).toEqual(overview);
    expect(sent).toEqual([{ call: "GET /imports", body: undefined }]);
    expect(JSON.stringify(sent)).not.toContain("summit");
  });

  it("W-2: the dry run sends exactly the kind, the file name, the chosen columns in field order with every row, and the mapping", async () => {
    const { client, sent, changes } = fakeApi({
      "POST /imports/check": { status: 200, body: { rows: [], counts: { create: 2, update: 0, skip: 0, error: 0 } } },
    });
    await client.previewImport("summit", { ...customersRequest(), expected: "cc" });
    expect(sent).toEqual([
      {
        call: "POST /imports/check",
        body: {
          kind: "customers",
          fileName: "customers.csv",
          table: {
            headers: ["Account Number", "Customer Name", "E-mail"],
            rows: [
              ["CUST-9001", "Maple Row Builders", "orders@maplerow.example"],
              ["CUST-9002", "Avery Collins", "avery.collins@mail.example"],
              ["", "", ""],
            ],
          },
          mapping: FULL_MAPPING,
        },
      },
    ]);
    // The unchosen Notes column never leaves the browser, and a dry run is no write.
    expect(JSON.stringify(sent)).not.toContain("call first");
    expect(changes()).toBe(0);
  });

  it("W-3: the import sends the dry run's actions, and the screens read again after a 201 and after a 409", async () => {
    const result = { batch: SUMMARY, rows: [] };
    const done = fakeApi({ "POST /imports": { status: 201, body: result } });
    expect(await done.client.runImport("summit", { ...customersRequest(), expected: "cce" })).toEqual(result);
    expect(done.sent).toHaveLength(1);
    expect(done.sent[0]!.call).toBe("POST /imports");
    expect(done.sent[0]!.body).toMatchObject({ kind: "customers", mapping: FULL_MAPPING, expected: "cce" });
    expect(done.changes()).toBe(1);

    const stale = fakeApi({
      "POST /imports": { status: 409, body: { code: "plan_changed", message: IMPORT_WORDS.planChanged } },
    });
    const failure = await failureOf(stale.client.runImport("summit", { ...customersRequest(), expected: "cce" }));
    expect(failure).toBeInstanceOf(HttpApiError);
    expect(failure).toMatchObject({ status: 409, code: "plan_changed", message: IMPORT_WORDS.planChanged });
    expect(stale.changes()).toBe(1);
  });

  it("W-4: an Undo of a batch the API never made is refused with its words, and nothing is sent", async () => {
    const { client, sent, changes } = fakeApi();
    const failure = await failureOf(client.undoImport("summit", "imp-1"));
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure?.message).toBe("This import no longer exists.");
    expect(sent).toEqual([]);
    expect(changes()).toBe(0);
  });

  it("an Undo of a saved batch is POST /imports/:id/undo with no body, and the screens read again", async () => {
    const undone = { ...SUMMARY, undoneAt: "2026-11-16T09:00:00.000Z", undoneBy: "Luis Ortega" };
    const { client, sent, changes } = fakeApi({ [`POST /imports/${BATCH_ID}/undo`]: { status: 201, body: undone } });
    expect(await client.undoImport("summit", BATCH_ID)).toEqual(undone);
    expect(sent).toEqual([{ call: `POST /imports/${BATCH_ID}/undo`, body: undefined }]);
    expect(changes()).toBe(1);
  });

  it("W-5: saved columns are PUT /imports/mappings/:kind with only the columns", async () => {
    const saved = { id: BATCH_ID, kind: "customers", columns: FULL_MAPPING, savedAt: "2026-11-16T08:00:00.000Z" };
    const { client, sent, changes } = fakeApi({ "PUT /imports/mappings/customers": { status: 200, body: saved } });
    expect(await client.saveImportMapping("summit", "customers", FULL_MAPPING)).toEqual(saved);
    expect(sent).toEqual([{ call: "PUT /imports/mappings/customers", body: { columns: FULL_MAPPING } }]);
    expect(changes()).toBe(1);
  });

  it("W-6: a body over the API's limit in UTF-8 bytes is refused with words before anything is sent", async () => {
    // 2,000 rows with a name of 20 two-byte letters: about 80,000 characters, but about 120,000 bytes.
    const wide = "é".repeat(20);
    const rows = Array.from({ length: 2000 }, (_, i) => [`CUST-${i}`, wide, "", ""]);
    const heavy = customersRequest({
      table: { headers: ["Account Number", "Customer Name", "E-mail", "Notes"], rows },
    });
    expect(JSON.stringify(mappedTable(importKind("customers"), heavy)).length).toBeLessThan(IMPORT_LIMITS.requestBytes);
    expect(() => importBody(heavy)).toThrow(new ApiError(IMPORT_TOO_LARGE));

    const { client, sent, changes } = fakeApi();
    const failure = await failureOf(client.previewImport("summit", heavy));
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure?.message).toBe(IMPORT_TOO_LARGE);
    expect(await failureOf(client.runImport("summit", { ...heavy, expected: "c" }))).toBeInstanceOf(ApiError);
    expect(sent).toEqual([]);
    expect(changes()).toBe(0);
  });

  it("W-6: a file whose unchosen columns alone are 500 KB still goes, since only the chosen columns travel", async () => {
    const notes = "n".repeat(250);
    const rows = Array.from({ length: 2000 }, (_, i) => ["", notes, `C${i}`, `${i}`]);
    const request = customersRequest({ table: { headers: customersRequest().table.headers, rows } });
    expect(rows.reduce((sum, row) => sum + row[1]!.length, 0)).toBe(500_000);
    const body = importBody(request);
    expect(body.table.headers).toEqual(["Account Number", "Customer Name", "E-mail"]);
    expect(new TextEncoder().encode(JSON.stringify(body)).length).toBeLessThanOrEqual(IMPORT_LIMITS.requestBytes);

    const { client, sent } = fakeApi({
      "POST /imports/check": { status: 200, body: { rows: [], counts: { create: 0, update: 0, skip: 0, error: 0 } } },
    });
    await client.previewImport("summit", request);
    expect(sent).toHaveLength(1);
    expect(JSON.stringify(sent[0]!.body)).not.toContain(notes);
  });

  it("sends a mapping of the kind's own fields only, never a key the screen happened to hold", () => {
    const body = importBody(customersRequest({ mapping: { ...customersRequest().mapping, companyId: "summit" } }));
    expect(body.mapping).toEqual(FULL_MAPPING);
    expect(Object.keys(body)).toEqual(["kind", "fileName", "table", "mapping"]);
  });
});
