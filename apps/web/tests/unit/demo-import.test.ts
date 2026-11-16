import { describe, expect, it } from "vitest";
import {
  FULL_IMPORT_HOLDER,
  IMPORT_LIMITS,
  IMPORT_WORDS,
  importKindsOpen,
  planActions,
  type AuditEntry,
  type ColumnMapping,
  type DataScope,
  type ImportRequest,
  type PermissionKey,
  type Role,
} from "@workspace/shared";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";

/** Summit's Owner (fixtures), who may import everything and opens View as. */
const OWNER = "sm-usr-01";
const OWNER_NAME = "Dana Whitfield";

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

/** A fresh demo store with Summit open for its Owner (each test starts from the fixtures). */
async function summit(): Promise<DemoStore> {
  const store = new DemoStore(noFiles);
  await store.openCompany("summit", { userId: OWNER, viewAsRoleId: null });
  return store;
}

/** The refusal an action gives, or "" when it was allowed. */
async function refusal(action: Promise<unknown>): Promise<string> {
  try {
    await action;
    return "";
  } catch (failure) {
    return failure instanceof Error ? failure.message : String(failure);
  }
}

/** The customer keys an importer of customers needs, without the credit-limit key (ADR 0057 S-3). */
const CUSTOMER_IMPORTER: PermissionKey[] = [
  "settings.import.manage",
  "customers.customer.view",
  "customers.customer.create",
  "customers.customer.edit",
];

/**
 * Saves a custom role as the Owner and views the company as it (View as), the way a person with
 * only these keys would use the wizard.
 */
async function viewAs(store: DemoStore, permissions: PermissionKey[], dataScope: DataScope = "all") {
  const sales = (await store.list("roles")).find((r) => r.key === "sales")!;
  const role: Role = {
    ...sales,
    id: `sm-role-import-${dataScope}`,
    key: `import-${dataScope}`,
    name: `Customer importer (${dataScope})`,
    system: false,
    permissions,
    dataScope,
  };
  await store.saveRole(role);
  store.setViewer({ userId: OWNER, viewAsRoleId: role.id });
}

/** A customers file as the wizard sends it, every column chosen by hand. */
function customersFile(rows: string[][], mapping: ColumnMapping, fileName = "customers.csv"): ImportRequest {
  return {
    kind: "customers",
    fileName,
    table: { headers: ["Account Number", "Customer Name", "E-mail", "Credit limit"], rows },
    mapping,
  };
}

const WITH_CREDIT: ColumnMapping = {
  external_id: "Account Number",
  name: "Customer Name",
  email: "E-mail",
  credit_limit: "Credit limit",
};
const WITHOUT_CREDIT: ColumnMapping = { external_id: "Account Number", name: "Customer Name", email: "E-mail" };
const MAPLE = ["CUST-9001", "Maple Row Builders", "orders@maplerow.example", "25000"];

const NO_CREDIT_LIMIT = "Your role can't see credit limit, so leave the Credit limit column out.";

/** Every key of every object in a value, at any depth. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((item) => keysOf(item, into));
  else if (value && typeof value === "object") {
    for (const [key, inner] of Object.entries(value)) {
      into.add(key);
      keysOf(inner, into);
    }
  }
  return into;
}

describe("the demo import applies the API's shared rules (ADR 0057, plan 5.3)", () => {
  it("D-1 refuses a mapped credit limit to a role without the key, with the shared words", async () => {
    const store = await summit();
    await viewAs(store, CUSTOMER_IMPORTER);

    // The kinds offered are those the role's own keys cover.
    expect((await store.importOverview("summit")).kinds).toEqual(["customers", "addresses"]);

    const file = customersFile([MAPLE], WITH_CREDIT);
    expect(await refusal(store.previewImport("summit", file))).toBe(NO_CREDIT_LIMIT);
    expect(await refusal(store.runImport("summit", file))).toBe(NO_CREDIT_LIMIT);

    // Left out, the same file checks and imports.
    const without = customersFile([MAPLE], WITHOUT_CREDIT);
    const preview = await store.previewImport("summit", without);
    expect(preview.counts).toEqual({ create: 1, update: 0, skip: 0, error: 0 });
    const result = await store.runImport("summit", { ...without, expected: planActions(preview.rows) });
    expect(result.batch.counts.create).toBe(1);

    // Other kinds stay closed, whatever the screen sends.
    expect(
      await refusal(
        store.previewImport("summit", {
          kind: "suppliers",
          fileName: "suppliers.csv",
          table: { headers: ["Name"], rows: [["Cobalt Trim Works"]] },
          mapping: { name: "Name" },
        }),
      ),
    ).toBe("Your role can't see, add and change suppliers, so it can't import them.");
  });

  it("D-1 refuses an importer whose data scope is narrower than the company", async () => {
    const store = await summit();
    await viewAs(store, CUSTOMER_IMPORTER, "branch");
    expect((await store.importOverview("summit")).kinds).toEqual([]);
    expect(await refusal(store.previewImport("summit", customersFile([MAPLE], WITHOUT_CREDIT)))).toBe(
      "Importing needs company-wide data scope, because rows are matched against every record.",
    );
  });

  it("D-2 refuses an import whose rows would no longer do what was checked, and never sends the saved records", async () => {
    const store = await summit();
    const file = customersFile([MAPLE, ["CUST-9002", "Granite Peak Homes", "not-an-email", "15000"]], WITH_CREDIT);
    const preview = await store.previewImport("summit", file);
    expect(planActions(preview.rows)).toBe("ce");

    expect(await refusal(store.runImport("summit", { ...file, expected: "ss" }))).toBe(IMPORT_WORDS.planChanged);
    expect((await store.importOverview("summit")).batches).toEqual([]);

    const result = await store.runImport("summit", { ...file, expected: "ce" });
    expect(result.batch).toMatchObject({ number: "IMP-1001", byName: OWNER_NAME, undoneAt: null });
    expect(keysOf(result.batch).has("changes")).toBe(false);

    // The same request again plans a skip, so it no longer matches what was checked.
    expect(await refusal(store.runImport("summit", { ...file, expected: "ce" }))).toBe(IMPORT_WORDS.planChanged);
    expect(await refusal(store.runImport("summit", file))).toBe(IMPORT_WORDS.nothing);

    const overview = await store.importOverview("summit");
    expect(overview.batches.map((b) => b.number)).toEqual(["IMP-1001"]);
    expect(keysOf(overview.batches).has("changes")).toBe(false);

    const undone = await store.undoImport("summit", result.batch.id);
    expect(undone).toMatchObject({ number: "IMP-1001", undoneBy: OWNER_NAME });
    expect(keysOf(undone).has("changes")).toBe(false);
    expect(await refusal(store.undoImport("summit", result.batch.id))).toBe(IMPORT_WORDS.alreadyUndone("IMP-1001"));
    expect(await refusal(store.undoImport("summit", "no-such-batch"))).toBe(IMPORT_WORDS.gone);
    expect((await store.list("customers")).some((c) => c.name === "Maple Row Builders")).toBe(false);
  });

  it("D-3 leaves supplier contacts unchanged on a dry run of a new supplier with a contact", async () => {
    const store = await summit();
    const before = await store.list("supplierContacts");
    const request: ImportRequest = {
      kind: "suppliers",
      fileName: "suppliers.csv",
      table: {
        headers: ["Name", "Contact", "Email"],
        rows: [["Cobalt Trim Works", "Jamie Fox", "orders@cobalttrim.example"]],
      },
      mapping: { name: "Name", contact_name: "Contact", email: "Email" },
    };
    const preview = await store.previewImport("summit", request);
    expect(preview.counts.create).toBe(1);
    expect(await store.list("supplierContacts")).toEqual(before);

    // The import itself adds the contact, as the email's preferred method.
    await store.runImport("summit", { ...request, expected: planActions(preview.rows) });
    const added = (await store.list("supplierContacts")).filter((c) => !before.some((b) => b.id === c.id));
    expect(added).toMatchObject([{ name: "Jamie Fox", preferredMethod: "email", isPrimary: true }]);
  });

  it("needs for an Undo the keys the import needed, since it puts sensitive values back", async () => {
    const store = await summit();
    const result = await store.runImport("summit", customersFile([MAPLE], WITH_CREDIT));
    await viewAs(store, CUSTOMER_IMPORTER);
    expect(await refusal(store.undoImport("summit", result.batch.id))).toBe(NO_CREDIT_LIMIT);

    store.setViewer({ userId: OWNER, viewAsRoleId: null });
    expect((await store.undoImport("summit", result.batch.id)).undoneAt).not.toBeNull();
  });

  it("offers the platform admin every kind the company's modules and switches allow", async () => {
    const store = await summit();
    const company = await store.getCompany();
    const everything = importKindsOpen(company.modules, FULL_IMPORT_HOLDER);
    expect((await store.importOverview("summit")).kinds).toEqual(everything);
    store.closeCompany();
    expect((await store.importOverview("summit")).kinds).toEqual(everything);
  });

  it("refuses the size and column choices the API refuses, with the same words", async () => {
    const store = await summit();
    const rows = Array.from({ length: IMPORT_LIMITS.rows + 1 }, (_, i) => [`CUST-${i}`, `Builder ${i}`, "", ""]);
    expect(await refusal(store.previewImport("summit", customersFile(rows, WITHOUT_CREDIT)))).toBe(
      "This file has 2001 rows. Import up to 2,000 at a time; split the file.",
    );
    const unknownField = { ...WITHOUT_CREDIT, favourite: "Credit limit" };
    expect(await refusal(store.previewImport("summit", customersFile([MAPLE], unknownField)))).toBe(
      "The column choices name a field this import doesn't have.",
    );
    expect(await refusal(store.previewImport("summit", customersFile([MAPLE], { name: "Customer" })))).toBe(
      "“Customer” is not a column of this file.",
    );
  });

  it("saves columns only for a kind the person may import, and audits the save", async () => {
    const store = await summit();
    await viewAs(store, CUSTOMER_IMPORTER);
    expect(await refusal(store.saveImportMapping("summit", "suppliers", { name: "Name" }))).toBe(
      "Your role can't see, add and change suppliers, so it can't import them.",
    );
    // Header names need no sensitive key: only the values do.
    const saved = await store.saveImportMapping("summit", "customers", WITH_CREDIT);
    expect(saved.columns).toMatchObject({ name: "Customer Name", credit_limit: "Credit limit", phone: null });
    expect(Object.keys(saved)).toEqual(["id", "kind", "columns", "savedAt"]);

    store.setViewer({ userId: OWNER, viewAsRoleId: null });
    const entry = ((await store.list("audit")) as AuditEntry[]).find((e) => e.action === "Saved import columns");
    expect(entry).toMatchObject({
      category: "data",
      target: "Customers",
      before: null,
      after: "External ID ← Account Number; Name ← Customer Name; Email ← E-mail; Credit limit ← Credit limit",
    });
  });
});
