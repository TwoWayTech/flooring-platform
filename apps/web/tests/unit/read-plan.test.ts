import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIST_READS,
  mayReadList,
  PRODUCT_ROLES,
  roleTemplate,
  type CompanyAnswer,
  type DefaultRoleKey,
  type ListReadPath,
  type PermissionKey,
} from "@workspace/shared";
import type { ApiClient } from "@/lib/api/contract";
import { loadSalesLedger } from "@/lib/sales-ledger";
import { fakeApi, type FakeAnswer } from "./fake-api";

/**
 * The api-mode reads of the pages click-through findings #28 and #29 name, as the pages make them:
 * the dashboard (its loader, Contracts widget and Warehouse today), Contracts, a contract,
 * Inventory, a quote (new or saved) and an invoice. Settings and the demo-only lists are left out:
 * they never reach the API through the reads below.
 */
const PAGES: Record<string, (client: ApiClient) => Promise<unknown>> = {
  dashboard: (client) =>
    Promise.all([
      loadSalesLedger(client),
      client.list("locations"),
      client.list("users"),
      client.list("contracts"),
      client.list("contractLines"),
      client.list("contractBillings"),
      client.list("changeOrders"),
      client.listStockHolds(),
    ]),
  contracts: (client) => client.contractsData(),
  contract: (client) => Promise.all([client.contractsData(), client.list("invoices"), client.list("payments")]),
  inventory: (client) => Promise.all([client.inventoryData(), client.list("users")]),
  quote: (client) => Promise.all([client.salesData(), client.inventoryData()]),
  invoice: (client) =>
    Promise.all([client.salesData(), client.inventoryData(), loadSalesLedger(client), client.list("users")]),
};

const TENANT = "0195f3a2-7b1c-7d4e-8f00-0000000000c1";
const ME = "0195f3a2-7b1c-7d4e-8f00-0000000000a3";

/** GET /company for a person whose effective permissions are `permissions`. */
function companyAnswer(permissions: readonly PermissionKey[]): CompanyAnswer {
  return {
    company: {
      id: TENANT,
      slug: "summit",
      name: "Summit Floor Co.",
      city: "Denver",
      state: "CO",
      timeZone: "America/Denver",
      modules: ["platform", "core", "retail"],
      ceiling: [...permissions],
      branches: [],
    },
    me: {
      id: ME,
      companyId: TENANT as CompanyAnswer["me"]["companyId"],
      name: "Priya Natarajan",
      email: "priya@example.test",
      title: "",
      roleIds: [],
      branchId: "",
      status: "active",
      mfaEnrolled: false,
      lastLoginAt: null,
      employeeId: null,
      defaultLocationId: null,
    },
    roles: [],
    access: { permissions: [...permissions], dataScope: "own", isOwner: false },
    people: [{ id: ME, name: "Priya Natarajan", status: "active" }],
  };
}

/** The path of a "GET /path" call, when it is one of the list reads. */
function listPath(call: string): ListReadPath | null {
  const path = call.replace(/^GET /, "");
  return call.startsWith("GET ") && path in LIST_READS ? (path as ListReadPath) : null;
}

/**
 * A fake API that refuses, as PermissionGuard does, every list read `permissions` doesn't allow,
 * and answers every other GET with an empty list. Its client has read GET /company when `known`.
 */
async function apiFor(permissions: readonly PermissionKey[], known = true) {
  const held = new Set(permissions);
  const fake = fakeApi({ "GET /company": { status: 200, body: companyAnswer(permissions) } }, (call): FakeAnswer => {
    const path = listPath(call);
    return path && !mayReadList(path, held) ? { status: 403, body: { code: "forbidden" } } : { status: 200, body: [] };
  });
  if (known) await fake.client.getWorkspace();
  return fake;
}

/** The requests a page's reads send, after GET /company, and how many the fake refused. */
async function plan(page: keyof typeof PAGES, permissions: readonly PermissionKey[], known = true) {
  const fake = await apiFor(permissions, known);
  const before = fake.sent.length;
  await PAGES[page]!(fake.client);
  const calls = fake.sent.slice(before).map((sent) => sent.call);
  const held = new Set(permissions);
  const refused = calls.filter((call) => {
    const path = listPath(call);
    return path !== null && !mayReadList(path, held);
  });
  return { calls, refused };
}

// The gate and sharing apply in a browser only (`ReadShare`); these are the browser's plans.
beforeEach(() => vi.stubGlobal("window", {}));
afterEach(() => vi.unstubAllGlobals());

const permissionsOf = (role: DefaultRoleKey): PermissionKey[] => roleTemplate(role).permissions;

describe("the pages ask only for the lists the person's role may read (finding #28)", () => {
  for (const role of PRODUCT_ROLES.flooring) {
    it(`sends no refused read as ${role}`, async () => {
      for (const page of Object.keys(PAGES)) {
        const { refused } = await plan(page, permissionsOf(role));
        expect(refused, `${role} on ${page}`).toEqual([]);
      }
    });
  }

  it("skips, for Sales, exactly the reads the click-through saw refused", async () => {
    const skipped = ["/lien-waivers", "/insurance-certificates", "/suppliers", "/bills", "/supplier-payments"];
    const contract = await plan("contract", permissionsOf("sales"));
    for (const path of skipped) expect(contract.calls).not.toContain(`GET ${path}`);
    expect(contract.calls).toContain("GET /contracts");
    const quote = await plan("quote", permissionsOf("sales"));
    expect(quote.calls).not.toContain("GET /transfers");
    expect(quote.calls).toContain("GET /products");
  });

  it("asks for every list while the person's access is not yet known, and the API still decides", async () => {
    const { calls, refused } = await plan("contract", permissionsOf("sales"), false);
    expect(calls).toContain("GET /lien-waivers");
    expect(refused.length).toBeGreaterThan(0);
  });

  it("asks the Owner for every list of a contract", async () => {
    const { calls } = await plan("contract", permissionsOf("owner"));
    expect(new Set(calls)).toEqual(
      new Set(
        [
          "/contracts",
          "/contract-lines",
          "/change-orders",
          "/contract-billings",
          "/lien-waivers",
          "/insurance-certificates",
          "/customers",
          "/suppliers",
          "/locations",
          "/bills",
          "/supplier-payments",
          "/contract-schedule",
          "/supplier-contacts",
          "/invoices",
          "/payments",
        ].map((path) => `GET ${path}`),
      ),
    );
  });
});

describe("a page sends each read once (finding #29)", () => {
  it.each(Object.keys(PAGES))("%s: no request twice", async (page) => {
    const { calls } = await plan(page, permissionsOf("owner"));
    expect(calls.length).toBe(new Set(calls).size);
  });

  // Before: 16 for the Owner (the whole invoice list first, then /invoices and /locations twice).
  it("the invoice page sends 13 reads for the Owner and 12 for Sales, at once", async () => {
    expect((await plan("invoice", permissionsOf("owner"))).calls).toHaveLength(13);
    expect((await plan("invoice", permissionsOf("sales"))).calls).toHaveLength(12);
  });

  // Before: 18 for the Owner, the Contracts widget alone loading the register's eleven lists.
  it("the dashboard sends 11 reads for the Owner", async () => {
    expect((await plan("dashboard", permissionsOf("owner"))).calls).toHaveLength(11);
  });
});
