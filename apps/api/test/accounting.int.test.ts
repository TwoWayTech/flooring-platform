import {
  auditLog,
  branches,
  ledgerAccounts,
  locations,
  products,
  rolePermissions,
  roles,
  settings,
  taxRules,
} from "@workspace/db/company";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import { dec, moneyString } from "@workspace/shared";
import { eq, like } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthHarness, PASSWORD, sessionCookie } from "./auth-harness";

/** Today in the test company's time zone (America/Chicago), which is the day the API dates by. */
function companyDay(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Summit's localization settings without the tax tables, as a company's settings row holds them. */
function summitLocalization() {
  const file = createRequire(import.meta.url).resolve("@workspace/shared/fixtures/summit.json");
  const fixtures = JSON.parse(readFileSync(file, "utf8")) as { settings: { localization: Record<string, unknown> } };
  const { tax, ...rest } = fixtures.settings.localization as { tax: Record<string, unknown> } & Record<string, unknown>;
  const taxRest: Record<string, unknown> = { ...tax };
  delete taxRest.rules;
  delete taxRest.jurisdictions;
  return { ...rest, tax: taxRest };
}

const PDF = { name: "receipt.pdf", data: Buffer.from("%PDF-1.4\n% proof of payment\n").toString("base64") };

interface TrialBalance {
  balanced: boolean;
  rows: { key: string | null; name: string; code: string; balance: string }[];
}

/**
 * Settings → Accounting (ADR 0040; owner decision 2026-11-14): defaults, bank accounts as ledger
 * accounts, cash posted to the bank account for the payment's method, voids back to the same bank,
 * removal rules, permissions and audit.
 */
describe("accounting settings and bank accounts (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let warehouse = "";
  let tile = "";
  const cookies = { owner: "", accountant: "", sales: "" };

  function call(method: "get" | "post" | "put", path: string, cookie: string) {
    return request(harness.app.getHttpServer())
      [method](path)
      .set("X-Forwarded-Host", "localhost:3000")
      .set("Cookie", cookie);
  }

  async function enrolled(email: string) {
    const first = await harness.signIn(email);
    const enabled = await harness.post("/api/auth/two-factor/enable").set("Cookie", first).send({ password: PASSWORD });
    const secret = totpSecretFromUri(enabled.body.totpURI as string);
    const confirmed = await harness
      .post("/api/auth/two-factor/verify-totp")
      .set("Cookie", first)
      .send({ code: totpCode(secret) });
    return sessionCookie(confirmed.headers["set-cookie"]);
  }

  /** An invoice for 100 sq ft of tile (489.65 with tax), made by the owner. */
  async function invoice(): Promise<{ id: string; customerId: string }> {
    const customer = await call("post", "/customers", cookies.owner)
      .send({ name: `Cust ${uuidv7()}` })
      .expect(201);
    const quote = await call("post", "/quotes", cookies.owner)
      .send({
        customerId: customer.body.id,
        locationId: warehouse,
        jobSite: { street: "12 Pine Rd", city: "Denver", state: "CO", zip: "80202" },
        rooms: [],
        lines: [
          {
            id: "draft-1",
            productId: tile,
            description: "Slate Tile",
            category: "material",
            unit: "sq_ft",
            quantity: "100",
            unitPrice: "4.50",
            unitCost: "0",
            wastePct: "10",
          },
        ],
        depositPct: "0",
        taxOverride: null,
        notes: "",
      })
      .expect(201);
    const sentQuote = await call("post", `/quotes/${quote.body.id}/status`, cookies.owner)
      .send({ action: "send", expiresAt: "2099-01-01" })
      .expect(201);
    await call("post", `/quotes/${quote.body.id}/status`, cookies.owner)
      .send({ action: "accept", expectedTotal: sentQuote.body.total })
      .expect(201);
    return (await call("post", `/quotes/${quote.body.id}/invoice`, cookies.owner).expect(201)).body;
  }

  /** A card payment the owner records; 50.00 is under the approval threshold, so it is confirmed. */
  async function cardPayment(invoiceId: string): Promise<{ id: string; status: string }> {
    const paid = await call("post", "/payments", cookies.owner)
      .send({
        invoiceId,
        kind: "payment",
        amount: "50.00",
        date: companyDay(),
        method: "card",
        checkNumber: "",
        cardLast4: "4242",
        reference: `TXN-${uuidv7()}`,
        note: "",
        extraAsCredit: false,
        allowDuplicateReference: false,
        files: [PDF],
      })
      .expect(201);
    return paid.body;
  }

  async function balances(): Promise<Map<string, string>> {
    const body = (await call("get", "/ledger/trial-balance", cookies.owner).expect(200)).body as TrialBalance;
    expect(body.balanced).toBe(true);
    return new Map(body.rows.flatMap((row) => (row.key ? [[row.key, row.balance] as const] : [])));
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("acct");
    const handle = await harness.companyDb(company.id);
    try {
      const [branch] = await handle.db
        .insert(branches)
        .values({ name: "Denver", city: "Denver", state: "CO" })
        .returning();
      const address = { street: "1 Main St", city: "Denver", state: "CO", zip: "80202" };
      const [store] = await handle.db
        .insert(locations)
        .values({ name: "Denver warehouse", kind: "warehouse" as const, branchId: branch.id, address, isDefault: true })
        .returning();
      const [product] = await handle.db
        .insert(products)
        .values({
          sku: `T-${uuidv7()}`,
          name: "Slate Tile",
          category: "porcelain_tile" as const,
          unit: "sq_ft" as const,
          price: "4.5000",
          cost: "2.1000",
          sqFtPerCarton: "20",
        })
        .returning();
      await handle.db.insert(settings).values([
        { group: "localization", value: summitLocalization() },
        {
          group: "payments",
          value: {
            approvalRequired: true,
            approvalThreshold: "100.00",
            writeOffMax: "5.00",
            paymentPrefix: "PAY-",
            refundPrefix: "RF-",
          },
        },
      ]);
      await handle.db.insert(taxRules).values({
        state: "CO",
        jurisdiction: "Denver combined",
        ratePct: "8.81",
        taxable: { material: true, labor: false, freight: false, service: false },
        lumpSumLaborTaxable: true,
        validFrom: "2025-01-01",
        version: 1,
      });
      warehouse = store.id;
      tile = product.id;
    } finally {
      await handle.close();
    }
    cookies.owner = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["owner"] }));
    cookies.accountant = await enrolled(await harness.addUser({ companyIds: [company.id], roles: ["accountant"] }));
    cookies.sales = await harness.signIn(await harness.addUser({ companyIds: [company.id], roles: ["sales"] }));
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("starts on the owner's defaults, and only settings.payments.manage reads or changes them", async () => {
    const read = await call("get", "/settings/accounting", cookies.accountant).expect(200);
    expect(read.body).toEqual({ costingMethod: "average", salesTaxBasis: "accrual", bankAccounts: [] });
    expect((await call("get", "/settings/accounting", cookies.sales)).status).toBe(403);
    expect(
      (await call("put", "/settings/accounting", cookies.sales).send({ ...read.body, salesTaxBasis: "cash" })).status,
    ).toBe(403);
    // The key needs MFA: an Accountant who has not set it up is refused (PR #19 security review).
    const unenrolled = await harness.signIn(await harness.addUser({ companyIds: [company.id], roles: ["accountant"] }));
    const refused = await call("get", "/settings/accounting", unenrolled);
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("mfa_enrolment_required");
    // The settings decide where the whole company's cash posts, so a branch-scoped role is refused
    // even with the permission (PR #19 security review).
    const handle = await harness.companyDb(company.id);
    try {
      const [role] = await handle.db
        .insert(roles)
        .values({ key: "branch-bookkeeper", name: "Branch bookkeeper", dataScope: "branch" as const })
        .returning();
      await handle.db.insert(rolePermissions).values({ roleId: role.id, permissionKey: "settings.payments.manage" });
    } finally {
      await handle.close();
    }
    const bookkeeper = await enrolled(
      await harness.addUser({ companyIds: [company.id], roles: ["branch-bookkeeper"] }),
    );
    expect((await call("get", "/settings/accounting", bookkeeper)).status).toBe(403);
    expect(
      (await call("put", "/settings/accounting", bookkeeper).send({ ...read.body, salesTaxBasis: "cash" })).status,
    ).toBe(403);
  });

  it("makes a ledger account per bank account and refuses ambiguous or forged lists", async () => {
    const base = { costingMethod: "average", salesTaxBasis: "cash" };
    const bad = [
      {
        bankAccounts: [
          { name: "A", methods: ["card"] },
          { name: "B", methods: ["card"] },
        ],
      },
      { bankAccounts: [{ key: `bank:${uuidv7()}`, name: "Forged", methods: [] }] },
      { bankAccounts: [{ name: "Operating", methods: ["wire"] }] },
      { bankAccounts: [{ name: "Operating", methods: [], number: "123456789" }] },
    ];
    // The step-up comes after the body is read, so these reach the content checks (ADR 0040, 2026-11-20).
    await harness.grantStepUp(cookies.accountant);
    for (const body of bad) {
      expect((await call("put", "/settings/accounting", cookies.accountant).send({ ...base, ...body })).status).toBe(
        400,
      );
    }
    await harness.grantStepUp(cookies.accountant);
    const saved = await call("put", "/settings/accounting", cookies.accountant)
      .send({
        ...base,
        bankAccounts: [
          { name: "Operating", methods: ["check", "ach"] },
          { name: "Merchant", methods: ["card"] },
          { name: "Spare", methods: [] },
        ],
      })
      .expect(200);
    expect(saved.body.salesTaxBasis).toBe("cash");
    const keys = (saved.body.bankAccounts as { key: string }[]).map((bank) => bank.key);
    expect(keys.every((key) => /^bank:[0-9a-f-]{36}$/.test(key))).toBe(true);
    const handle = await harness.companyDb(company.id);
    try {
      const rows = await handle.db.select().from(ledgerAccounts).where(like(ledgerAccounts.key, "bank:%"));
      expect(rows.map((row) => [row.name, row.code, row.type]).sort()).toEqual([
        ["Merchant", "1011", "asset"],
        ["Operating", "1010", "asset"],
        ["Spare", "1012", "asset"],
      ]);
      const audit = await handle.db.select().from(auditLog).where(eq(auditLog.action, "Changed accounting settings"));
      expect(audit).toHaveLength(1);
    } finally {
      await handle.close();
    }
  });

  it("posts a card payment to its bank, and its void back to that bank after the method moves", async () => {
    const current = (await call("get", "/settings/accounting", cookies.owner).expect(200)).body as {
      bankAccounts: { key: string; name: string; methods: string[] }[];
    };
    const merchant = current.bankAccounts.find((bank) => bank.name === "Merchant")!.key;
    const operating = current.bankAccounts.find((bank) => bank.name === "Operating")!.key;
    const before = await balances();
    const paid = await cardPayment((await invoice()).id);
    expect(paid.status).toBe("confirmed");
    const after = await balances();
    expect(after.get(merchant)).toBe("50.00");
    expect(after.get("cash") ?? "0.00").toBe(before.get("cash") ?? "0.00");
    // Card payments now go to Operating; the void still credits Merchant, where the money went.
    const moved = current.bankAccounts.map((bank) =>
      bank.key === operating
        ? { ...bank, methods: [...bank.methods, "card"] }
        : bank.key === merchant
          ? { ...bank, methods: [] }
          : bank,
    );
    await harness.grantStepUp(cookies.owner);
    await call("put", "/settings/accounting", cookies.owner)
      .send({ costingMethod: "average", salesTaxBasis: "cash", bankAccounts: moved })
      .expect(200);
    await call("post", `/payments/${paid.id}/void`, cookies.owner).send({ reason: "Charged back" }).expect(201);
    const voided = await balances();
    expect(voided.get(merchant)).toBe("0.00");
    expect(voided.get(operating)).toBe("0.00");
  });

  it("keeps a bank account with entries, renames it, and retires an unused one", async () => {
    const current = (await call("get", "/settings/accounting", cookies.owner).expect(200)).body as {
      costingMethod: string;
      salesTaxBasis: string;
      bankAccounts: { key: string; name: string; methods: string[] }[];
    };
    const withoutMerchant = current.bankAccounts.filter((bank) => bank.name !== "Merchant");
    await harness.grantStepUp(cookies.owner);
    const refused = await call("put", "/settings/accounting", cookies.owner).send({
      ...current,
      bankAccounts: withoutMerchant,
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("bank_account_in_use");
    const renamed = current.bankAccounts
      .filter((bank) => bank.name !== "Spare")
      .map((bank) => (bank.name === "Merchant" ? { ...bank, name: "Card settlements" } : bank));
    await harness.grantStepUp(cookies.owner);
    await call("put", "/settings/accounting", cookies.owner)
      .send({ ...current, bankAccounts: renamed })
      .expect(200);
    const handle = await harness.companyDb(company.id);
    try {
      const rows = await handle.db.select().from(ledgerAccounts).where(like(ledgerAccounts.key, "bank:%"));
      const byName = new Map(rows.map((row) => [row.name, row]));
      expect(byName.get("Card settlements")?.deletedAt).toBeNull();
      expect(byName.get("Spare")?.deletedAt).not.toBeNull();
    } finally {
      await handle.close();
    }
  });

  it("posts a refund to the bank account for its method", async () => {
    const current = (await call("get", "/settings/accounting", cookies.owner).expect(200)).body as {
      bankAccounts: { key: string; name: string; methods: string[] }[];
    };
    const operating = current.bankAccounts.find((bank) => bank.methods.includes("check"))!.key;
    const bill = await invoice();
    // 500.00 on a 489.65 invoice leaves 10.35 of credit; above the threshold, so someone else confirms.
    const paid = await call("post", "/payments", cookies.owner)
      .send({
        invoiceId: bill.id,
        kind: "payment",
        amount: "500.00",
        date: companyDay(),
        method: "card",
        checkNumber: "",
        cardLast4: "4242",
        reference: `TXN-${uuidv7()}`,
        note: "",
        extraAsCredit: true,
        allowDuplicateReference: false,
        files: [PDF],
      })
      .expect(201);
    const pending = await balances();
    await call("post", `/payments/${paid.body.id}/review`, cookies.accountant).send({ action: "confirm" }).expect(201);
    const before = await balances();
    // Confirmed on review, the card payment posts to the bank card payments now go to.
    expect(moneyString(dec(before.get(operating)!).minus(pending.get(operating) ?? "0"))).toBe("500.00");
    await call("post", "/refunds", cookies.owner)
      .send({
        customerId: bill.customerId,
        amount: "10.00",
        date: companyDay(),
        method: "check",
        reference: `RF-CHK-${uuidv7()}`,
        note: "",
        files: [PDF],
      })
      .expect(201);
    const after = await balances();
    expect(moneyString(dec(after.get(operating)!).minus(before.get(operating) ?? "0"))).toBe("-10.00");
    expect(after.get("cash") ?? "0.00").toBe(before.get("cash") ?? "0.00");
  });

  it("refuses to post on stored settings that fail their schema, rather than using the defaults", async () => {
    const handle = await harness.companyDb(company.id);
    try {
      const [row] = await handle.db.select().from(settings).where(eq(settings.group, "accounting"));
      await handle.db
        .update(settings)
        .set({ value: { costingMethod: "average", salesTaxBasis: "accrual", bankAccounts: null } })
        .where(eq(settings.group, "accounting"));
      const read = await call("get", "/settings/accounting", cookies.owner);
      expect(read.status).toBe(409);
      expect(read.body.code).toBe("settings_invalid");
      await handle.db.update(settings).set({ value: row!.value }).where(eq(settings.group, "accounting"));
    } finally {
      await handle.close();
    }
  });
});
