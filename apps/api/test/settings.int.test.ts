import { Reflector } from "@nestjs/core";
import type { ExecutionContext } from "@nestjs/common";
import { productPermissions } from "@workspace/db";
import {
  auditLog,
  branches,
  locations,
  products,
  rolePermissions,
  roles,
  settings,
  suppliers,
  taxRules,
  userProfiles,
} from "@workspace/db/company";
import { tenantModuleOverrides, tenantPermissionCeiling } from "@workspace/db/control";
import {
  defaultNumberSettings,
  enabledModules,
  EXPENSE_MESSAGES,
  FEATURES,
  NUMBER_KINDS,
  numbersFromWire,
  numbersToWire,
  PAYMENT_MESSAGES,
  permissionsForModules,
  PRODUCT_HEADER,
  PRODUCT_ROLES,
  PROFILE_MESSAGES,
  profileFor,
  readableSections,
  roleTemplate,
  rolesRequireMfa,
  SENSITIVE_FIELDS,
  SETTINGS_SCOPE_MESSAGE,
  SETTINGS_SECTIONS,
  type CompanySettings,
  type FeatureKey,
  type NumberSettings,
  type NumberSettingsWire,
  type PermissionKey,
  type ProductKey,
  type SettingsAnswer,
} from "@workspace/shared";
import { and, asc, count, eq } from "drizzle-orm";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isAudited, permissionRequirement } from "../src/core/access/permission.decorators";
import { PERMISSION_REFUSALS } from "../src/core/access/permission.guard";
import { dayIn } from "../src/modules/sales/sales-common";
import { AuthHarness } from "./auth-harness";
import { platformHelpers } from "./support/platform-admins";

/** Summit's fixture settings, which the test companies copy. */
const SUMMIT = JSON.parse(
  readFileSync(createRequire(import.meta.url).resolve("@workspace/shared/fixtures/summit.json"), "utf8"),
) as { settings: CompanySettings };
const SERVED = ["profile", "numbers", "payments", "expenses"] as const;
type Served = (typeof SERVED)[number];

/** One company of the test: its tenant id and slug, and its product. */
interface TestCompany {
  id: string;
  slug: string;
  product: ProductKey;
}

/** A signed-in member; `secret` is set when the roles needed an authenticator app. */
interface Member {
  cookie: string;
  email: string;
  secret: string;
}

/** A small file that starts like a PDF, as proof. */
const PDF = { name: "receipt.pdf", data: Buffer.from("%PDF-1.4\n% proof of payment\n").toString("base64") };

/** The payments a company that never saved them is answered with (ADR 0059 D10). */
const NEVER_SAVED_PAYMENTS = {
  approvalRequired: true,
  approvalThreshold: "",
  writeOffMax: "0.00",
  paymentPrefix: "PAY-",
  refundPrefix: "RF-",
};
const BLANK_PROFILE = {
  legalName: "",
  dba: "",
  ein: "",
  phone: "",
  email: "",
  website: "",
  address: { street: "", city: "", state: "", zip: "" },
};

/** Every property name anywhere in a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf);
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);
  return [];
}

/** Summit's localization without its tax tables, as a company's settings row holds it. */
function summitLocalization() {
  const { tax, ...rest } = SUMMIT.settings.localization;
  const taxRest: Partial<typeof tax> = { ...tax };
  delete taxRest.rules;
  delete taxRest.jurisdictions;
  return { ...rest, tax: taxRest };
}

/**
 * Settings part 1 on the API (ADR 0059; spec settings-and-permissions.md, Real build, "Settings on
 * the API, part 1"): GET /settings cut per person, and PUT /settings/profile, /numbers, /payments
 * and /expenses with their keys, module, switch, scope, strict bodies, shared rules, step-up, row
 * lock and audit, against companies with databases of their own. Every case names its id first,
 * for the mutation runs.
 */
describe("settings part 1 on the API (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const { call, enrolled, stepUp } = platformHelpers(harness);
  const floorco: TestCompany = { id: "", slug: "", product: "flooring" };
  const peopleco: TestCompany = { id: "", slug: "", product: "hr" };
  const bareco: TestCompany = { id: "", slug: "", product: "flooring" };
  const otherco: TestCompany = { id: "", slug: "", product: "flooring" };
  const payco: TestCompany = { id: "", slug: "", product: "flooring" };
  /** One member per default role of floorco and peopleco, signed in once (no step-up). */
  const people = new Map<string, Member>();
  const pay = { warehouse: "", tile: "", owner: {} as Member, accountant: {} as Member };

  beforeAll(async () => {
    await harness.start();
    Object.assign(floorco, await harness.provisionCompany("floorco"));
    Object.assign(peopleco, await harness.provisionCompany("peopleco", ["hr"]));
    Object.assign(bareco, await harness.provisionCompany("bareco"));
    Object.assign(otherco, await harness.provisionCompany("otherco"));
    Object.assign(payco, await harness.provisionCompany("payco"));
    await seedRows(floorco);
    await seedRows(peopleco);
    await seedRows(otherco, { numbers: { ...SUMMIT.settings.numbers, negativeStyle: "parens" } });
    await seedRows(payco);
    for (const company of [floorco, peopleco])
      for (const key of PRODUCT_ROLES[company.product])
        people.set(`${company.product}:${key}`, await member(company, [key]));
    await withCompanyDb(payco, async (db) => {
      const [branch] = await db.insert(branches).values({ name: "Denver", city: "Denver", state: "CO" }).returning();
      const address = { street: "1 Main St", city: "Denver", state: "CO", zip: "80202" };
      const [store] = await db
        .insert(locations)
        .values({ name: "Denver warehouse", kind: "warehouse" as const, branchId: branch.id, address, isDefault: true })
        .returning();
      const [product] = await db
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
      await db.insert(settings).values({ group: "localization", value: summitLocalization() });
      await db.insert(taxRules).values({
        state: "CO",
        jurisdiction: "Denver combined",
        ratePct: "8.81",
        taxable: { material: true, labor: false, freight: false, service: false },
        lumpSumLaborTaxable: true,
        validFrom: "2025-01-01",
        version: 1,
      });
      pay.warehouse = store.id;
      pay.tile = product.id;
    });
    pay.owner = await member(payco, ["owner"]);
    pay.accountant = await member(payco, ["accountant"]);
  }, 300_000);

  afterAll(async () => {
    await harness.stop();
  });

  /** Runs `work` on a company's own database, behind the API's back. */
  async function withCompanyDb<T>(
    company: TestCompany,
    work: (db: Awaited<ReturnType<AuthHarness["companyDb"]>>["db"]) => Promise<T>,
  ): Promise<T> {
    const handle = await harness.companyDb(company.id);
    try {
      return await work(handle.db);
    } finally {
      await handle.close();
    }
  }

  /** Writes the four served rows from Summit's fixture, with any section replaced. */
  async function seedRows(company: TestCompany, over: Partial<Pick<CompanySettings, Served>> = {}) {
    await withCompanyDb(company, (db) =>
      db.insert(settings).values(SERVED.map((group) => ({ group, value: over[group] ?? SUMMIT.settings[group] }))),
    );
  }

  /** A signed-in member holding `roles` in `company`, enrolled in MFA when the roles need it. */
  async function member(company: TestCompany, held: string[], mfa = rolesRequireMfa(held)): Promise<Member> {
    const email = await harness.addUser({ companyIds: [company.id], roles: held });
    if (!mfa) return { cookie: await harness.signIn(email), email, secret: "" };
    const { cookie, secret } = await enrolled(email);
    return { cookie, email, secret };
  }

  /** The stored value of a settings group, or undefined. */
  function rowOf(company: TestCompany, group: Served): Promise<unknown> {
    return withCompanyDb(company, async (db) => {
      const [row] = await db.select({ value: settings.value }).from(settings).where(eq(settings.group, group));
      return row?.value;
    });
  }

  /** How many audit entries a company has. */
  function auditCount(company: TestCompany): Promise<number> {
    return withCompanyDb(company, async (db) => (await db.select({ n: count() }).from(auditLog))[0].n);
  }

  /** A company's audit entries with this action, oldest first. */
  function auditsOf(company: TestCompany, action: string) {
    return withCompanyDb(company, (db) =>
      db.select().from(auditLog).where(eq(auditLog.action, action)).orderBy(asc(auditLog.at)),
    );
  }

  /** `GET /settings` as `cookie`, which must answer 200. */
  async function answerOf(cookie: string): Promise<SettingsAnswer> {
    const response = await call("get", "/settings", cookie);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as SettingsAnswer;
  }

  function put(section: string, cookie: string, body: unknown) {
    return call("put", `/settings/${section}`, cookie).send(body as object);
  }

  /** A status and code pair, for compact refusal checks. */
  function outcome(response: { status: number; body: { code?: string } }) {
    return [response.status, response.body.code];
  }

  /** The permissions a default role holds in a fresh company of one product (as permissions.int.test.ts works them out). */
  function expectedPermissions(product: ProductKey, key: (typeof PRODUCT_ROLES)[ProductKey][number]): PermissionKey[] {
    const ceiling = new Set<PermissionKey>(productPermissions([product]));
    const enabled = new Set<PermissionKey>(permissionsForModules(enabledModules([product], null, [])));
    return roleTemplate(key).permissions.filter((permission) => ceiling.has(permission) && enabled.has(permission));
  }

  /** Whether a default role may save a section: its key, at data scope `all`. */
  function maySave(product: ProductKey, key: (typeof PRODUCT_ROLES)[ProductKey][number], section: Served): boolean {
    const held = expectedPermissions(product, key);
    return (
      SETTINGS_SECTIONS[section].keys.some((needed) => held.includes(needed)) && roleTemplate(key).dataScope === "all"
    );
  }

  /** The numbers wire of a company's stored numbers, with `negativeStyle` set. */
  function numbersBody(style: NumberSettings["negativeStyle"], base: NumberSettings = SUMMIT.settings.numbers) {
    return numbersToWire({ ...base, negativeStyle: style });
  }

  it("A0 the routes declare the shared table: keys, module and audit on each PUT, any member on the GET", async () => {
    const { SettingsController } = await import("../src/modules/settings/settings.controller");
    const reflector = new Reflector();
    const context = (handler: string) =>
      ({
        getHandler: () => (SettingsController.prototype as unknown as Record<string, unknown>)[handler],
        getClass: () => SettingsController,
      }) as unknown as ExecutionContext;
    const handlers: Record<Served, string> = {
      profile: "saveProfile",
      numbers: "saveNumbers",
      payments: "savePayments",
      expenses: "saveExpenses",
    };
    for (const section of SERVED) {
      const requirement = permissionRequirement(reflector, context(handlers[section]), "PUT");
      const rule = SETTINGS_SECTIONS[section];
      expect(requirement.permissions, section).toEqual(rule.keys);
      expect(requirement.module, section).toBe(rule.module === "platform" ? undefined : rule.module);
      expect(isAudited(reflector, context(handlers[section])), section).toBe(true);
    }
    expect(permissionRequirement(reflector, context("read"), "GET").anyMember).toBe(true);
  });

  for (const company of [floorco, peopleco]) {
    for (const key of PRODUCT_ROLES[company.product]) {
      it(`A1 ${company.product} ${key}: GET /settings answers the sections the role reads, cut per person`, async () => {
        const person = people.get(`${company.product}:${key}`)!;
        const before = await auditCount(company);
        const response = await call("get", "/settings", person.cookie);
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(response.headers["cache-control"]).toBe("no-store");
        const body = response.body as SettingsAnswer;
        const held = new Set(expectedPermissions(company.product, key));
        const expected = readableSections({ permissions: held, modules: enabledModules([company.product], null, []) });
        expect(Object.keys(body).sort()).toEqual([...expected].sort());
        for (const section of expected) {
          const stored = await rowOf(company, section);
          const want =
            section === "numbers"
              ? numbersToWire(stored as NumberSettings)
              : section === "profile"
                ? profileFor(stored as CompanySettings["profile"], held)
                : stored;
          expect(body[section], section).toEqual(want);
        }
        expect(body.numbers?.decimals).toHaveLength(7);
        expect(body.numbers?.decimals.map((entry) => entry.kind)).toContain("unitCost");
        expect(keysOf(body).filter((name) => name in SENSITIVE_FIELDS)).toEqual([]);
        expect(await auditCount(company)).toBe(before);
        if (company === floorco && key === "owner") {
          expect(Object.keys(body).sort()).toEqual(["expenses", "numbers", "payments", "profile"]);
          expect(body.profile?.ein).toBe(SUMMIT.settings.profile.ein);
        }
        if (company === floorco && key === "sales") {
          expect(Object.keys(body).sort()).toEqual(["numbers", "payments", "profile"]);
          expect(body.profile?.ein).toBe("");
        }
        if (company === floorco && key === "warehouse")
          expect(Object.keys(body).sort()).toEqual(["numbers", "profile"]);
        if (company === peopleco && key === "owner") {
          expect(Object.keys(body).sort()).toEqual(["numbers", "profile"]);
          expect(body.profile?.ein).toBe(SUMMIT.settings.profile.ein);
        }
      });
    }
  }

  it("A2 never saved: the answers the API acts on, and the first save creates the row with a null before", async () => {
    const owner = await member(bareco, ["owner"]);
    const body = await answerOf(owner.cookie);
    expect(body.numbers).toEqual(numbersToWire(defaultNumberSettings()));
    expect(body.expenses).toEqual({ approvalRequired: false, approvalThreshold: "" });
    expect(body.profile).toEqual(BLANK_PROFILE);
    expect(body.payments).toEqual(NEVER_SAVED_PAYMENTS);
    expect(await rowOf(bareco, "numbers")).toBeUndefined();
    const saved = await put("numbers", owner.cookie, numbersBody("parens", defaultNumberSettings()));
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(await rowOf(bareco, "numbers")).toEqual({ ...defaultNumberSettings(), negativeStyle: "parens" });
    const [entry] = await auditsOf(bareco, "Changed number format");
    expect(entry.before).toBeNull();
    expect(entry.after).toEqual(numbersBody("parens", defaultNumberSettings()));
  });

  for (const company of [floorco, peopleco]) {
    for (const key of PRODUCT_ROLES[company.product]) {
      it(`A3 ${company.product} ${key}: PUT /settings/numbers only with the key at scope all, stored, answered and audited`, async () => {
        const person = people.get(`${company.product}:${key}`)!;
        const style = key === "owner" ? "parens" : "minus";
        const body = numbersBody(style);
        const before = await rowOf(company, "numbers");
        const audits = (await auditsOf(company, "Changed number format")).length;
        const response = await put("numbers", person.cookie, body);
        if (!maySave(company.product, key, "numbers")) {
          expect(outcome(response), JSON.stringify(response.body)).toEqual([403, "forbidden"]);
          expect(await rowOf(company, "numbers")).toEqual(before);
          return;
        }
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(response.body).toEqual(body);
        expect(await rowOf(company, "numbers")).toEqual(numbersFromWire(body));
        expect((await answerOf(person.cookie)).numbers).toEqual(body);
        const entries = await auditsOf(company, "Changed number format");
        expect(entries, "one audit entry per save").toHaveLength(audits + 1);
        const entry = entries.at(-1)!;
        expect(entry).toMatchObject({ category: "settings", targetType: "settings", targetLabel: "Number format" });
        expect(entry.before).toEqual(numbersToWire(before as NumberSettings));
        expect(entry.after).toEqual(body);
      });
    }
  }

  it("A3b the wire's own checks: each kind once, known kinds, whole places in range, the list shape", async () => {
    const owner = people.get("flooring:owner")!;
    const base = numbersBody("minus");
    const before = await rowOf(floorco, "numbers");
    const audits = await auditCount(floorco);
    const decimals = (list: unknown) => ({ ...base, decimals: list });
    const cases: [unknown, string | null][] = [
      [decimals([...base.decimals, { kind: "money", places: 2 }]), "Give each kind of number once."],
      [decimals(base.decimals.slice(0, 6)), "Give each kind of number once."],
      [decimals([...base.decimals.slice(0, 6), { kind: "weight", places: 2 }]), null],
      [decimals(base.decimals.map((entry) => (entry.kind === "money" ? { ...entry, places: 2.5 } : entry))), null],
      [
        decimals(base.decimals.map((entry) => (entry.kind === "money" ? { ...entry, places: -1 } : entry))),
        `Choose between 0 and 4 decimals for ${NUMBER_KINDS.money.label}.`,
      ],
      [decimals(base.decimals.map((entry) => (entry.kind === "money" ? { ...entry, places: "2" } : entry))), null],
      [decimals(SUMMIT.settings.numbers.decimals), null],
    ];
    for (const [body, message] of cases) {
      const response = await put("numbers", owner.cookie, body);
      expect(outcome(response), JSON.stringify(body)).toEqual([400, "invalid_request"]);
      if (message) expect(response.body.message).toBe(message);
    }
    expect(await rowOf(floorco, "numbers")).toEqual(before);
    expect(await auditCount(floorco)).toBe(audits);
  });

  it("A4 PUT /settings/profile: only the Owner, a strict body and the shared rules", async () => {
    for (const company of [floorco, peopleco]) {
      for (const key of PRODUCT_ROLES[company.product]) {
        const response = await put("profile", people.get(`${company.product}:${key}`)!.cookie, SUMMIT.settings.profile);
        if (key === "owner") expect(response.status, JSON.stringify(response.body)).toBe(200);
        else expect(outcome(response), `${company.product} ${key}`).toEqual([403, "forbidden"]);
      }
    }
    const owner = people.get("flooring:owner")!;
    const profile = SUMMIT.settings.profile;
    const address = (patch: object) => ({ ...profile, address: { ...profile.address, ...patch } });
    const strict = [{ ...profile, unknown: "x" }, address({ unknown: "x" }), address({ lat: "x" })];
    for (const body of strict)
      expect(outcome(await put("profile", owner.cookie, body)), JSON.stringify(body)).toEqual([400, "invalid_request"]);
    const refused: [object, string][] = [
      [{ ...profile, ein: "12345" }, PROFILE_MESSAGES.ein],
      [address({ state: "XX" }), PROFILE_MESSAGES.state],
      [address({ zip: "8020" }), PROFILE_MESSAGES.zip],
      [{ ...profile, legalName: " " }, PROFILE_MESSAGES.legalName],
      [{ ...profile, email: "a@b" }, PROFILE_MESSAGES.email],
      [{ ...profile, website: "javascript:alert(1)" }, PROFILE_MESSAGES.website],
    ];
    for (const [body, message] of refused) {
      const response = await put("profile", owner.cookie, body);
      expect([...outcome(response), response.body.message]).toEqual([400, "invalid_request", message]);
    }
    const placed = address({ lat: 39.7, lng: -104.9 });
    const saved = await put("profile", owner.cookie, placed);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toEqual(placed);
    expect(await rowOf(floorco, "profile")).toEqual(placed);
  });

  it("A4b every section's body is strict: an unknown field answers 400 before any step-up, and nothing is stored", async () => {
    const owner = people.get("flooring:owner")!;
    const numbers = numbersBody("minus");
    const strict: [Served, object][] = [
      ["profile", { ...SUMMIT.settings.profile, unknown: "x" }],
      ["numbers", { ...numbers, unknown: "x" }],
      ["numbers", { ...numbers, decimals: numbers.decimals.map((entry) => ({ ...entry, unknown: "x" })) }],
      ["payments", { ...SUMMIT.settings.payments, unknown: "x" }],
      ["expenses", { ...SUMMIT.settings.expenses, unknown: "x" }],
    ];
    const before = await Promise.all(SERVED.map((section) => rowOf(floorco, section)));
    const audits = await auditCount(floorco);
    for (const [section, body] of strict)
      expect(outcome(await put(section, owner.cookie, body)), JSON.stringify(body)).toEqual([400, "invalid_request"]);
    expect(await Promise.all(SERVED.map((section) => rowOf(floorco, section)))).toEqual(before);
    expect(await auditCount(floorco)).toBe(audits);
  });

  it("A5 PUT /settings/payments: the key and module, content checks first, then a step-up", async () => {
    const rules = SUMMIT.settings.payments;
    for (const key of ["owner", "accountant"] as const) {
      const person = await member(floorco, [key]);
      const before = await rowOf(floorco, "payments");
      const audits = await auditCount(floorco);
      const unconfirmed = await put("payments", person.cookie, { ...rules, writeOffMax: "4.00" });
      expect(outcome(unconfirmed), key).toEqual([403, "step_up_required"]);
      expect(await rowOf(floorco, "payments")).toEqual(before);
      expect(await auditCount(floorco)).toBe(audits);
      const refused: [object, string][] = [
        [{ ...rules, approvalThreshold: "12." }, PAYMENT_MESSAGES.approvalThreshold],
        [{ ...rules, writeOffMax: "-1" }, PAYMENT_MESSAGES.writeOffMax],
        [{ ...rules, paymentPrefix: "PAY-", refundPrefix: "pay-" }, PAYMENT_MESSAGES.samePrefix],
      ];
      for (const [body, message] of refused) {
        const response = await put("payments", person.cookie, body);
        expect([...outcome(response), response.body.message], key).toEqual([400, "invalid_request", message]);
      }
      expect(outcome(await put("payments", person.cookie, { ...rules, approvalThreshold: 1000 }))).toEqual([
        400,
        "invalid_request",
      ]);
      await stepUp(person);
      const saved = await put("payments", person.cookie, { ...rules, writeOffMax: "4.00" });
      expect(saved.status, JSON.stringify(saved.body)).toBe(200);
      expect(saved.body).toEqual({ ...rules, writeOffMax: "4.00" });
      expect(await rowOf(floorco, "payments")).toEqual({ ...rules, writeOffMax: "4.00" });
      expect(await auditCount(floorco)).toBe(audits + 1);
      await put("payments", person.cookie, rules).expect(200);
    }
    for (const key of PRODUCT_ROLES.flooring.filter((role) => role !== "owner" && role !== "accountant"))
      expect(outcome(await put("payments", people.get(`flooring:${key}`)!.cookie, rules)), key).toEqual([
        403,
        "forbidden",
      ]);
    for (const key of PRODUCT_ROLES.hr)
      expect(outcome(await put("payments", people.get(`hr:${key}`)!.cookie, rules)), key).toEqual([
        403,
        "module_not_enabled",
      ]);
  });

  /** An invoice in payco for 100 sq ft of tile (489.65 with tax), made by its owner. */
  async function payInvoice(): Promise<{ id: string; number: string }> {
    const customer = await call("post", "/customers", pay.owner.cookie)
      .send({ name: `Cust ${uuidv7()}` })
      .expect(201);
    const quote = await call("post", "/quotes", pay.owner.cookie)
      .send({
        customerId: customer.body.id,
        locationId: pay.warehouse,
        jobSite: { street: "12 Pine Rd", city: "Denver", state: "CO", zip: "80202" },
        rooms: [],
        lines: [
          {
            id: "draft-1",
            productId: pay.tile,
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
    await call("post", `/quotes/${quote.body.id}/status`, pay.owner.cookie)
      .send({ action: "send", expiresAt: "2099-01-01" })
      .expect(201);
    await call("post", `/quotes/${quote.body.id}/status`, pay.owner.cookie).send({ action: "accept" }).expect(201);
    return (await call("post", `/quotes/${quote.body.id}/invoice`, pay.owner.cookie).expect(201)).body;
  }

  /** A card payment payco's owner records on an invoice. */
  async function cardPayment(invoiceId: string, amount: string): Promise<{ status: string; number: string }> {
    const paid = await call("post", "/payments", pay.owner.cookie).send({
      invoiceId,
      kind: "payment",
      amount,
      date: dayIn(new Date(), "America/Chicago"),
      method: "card",
      checkNumber: "",
      cardLast4: "4242",
      reference: `TXN-${uuidv7()}`,
      note: "",
      extraAsCredit: false,
      allowDuplicateReference: false,
      files: [PDF],
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    return paid.body;
  }

  /** A supplier in payco with one received and billed order of 100 sq ft at 2.10 (210.00). */
  async function billedSupplier(): Promise<string> {
    const supplier = await call("post", "/suppliers", pay.owner.cookie)
      .send({ name: `Supplier ${uuidv7()}`, email: "orders@example.test" })
      .expect(201);
    const placed = await call("post", "/purchase-orders", pay.owner.cookie)
      .send({
        supplierId: supplier.body.id,
        contactId: null,
        supplierRef: "",
        placedVia: "email",
        expectedAt: "2026-12-01",
        locationId: pay.warehouse,
        lines: [{ productId: pay.tile, description: "Slate Tile", quantity: "100", unit: "sq_ft", unitCost: "2.1000" }],
        asDraft: false,
      })
      .expect(201);
    await call("post", `/purchase-orders/${placed.body.id}/receipts`, pay.owner.cookie)
      .send({
        locationId: "",
        note: "",
        lines: [{ poLineId: placed.body.lines[0].id, productId: pay.tile, received: "100", damaged: "0", rolls: [] }],
      })
      .expect(201);
    await call("post", `/purchase-orders/${placed.body.id}/bills`, pay.owner.cookie)
      .send({ number: `B-${uuidv7()}`, issuedAt: dayIn(new Date(), "America/Chicago"), total: "210.00", files: [PDF] })
      .expect(201);
    return supplier.body.id as string;
  }

  /** A cash payment to a supplier by payco's owner. */
  async function supplierPayment(supplierId: string, amount: string): Promise<{ status: string }> {
    const paid = await call("post", "/supplier-payments", pay.owner.cookie).send({
      supplierId,
      amount,
      date: dayIn(new Date(), "America/Chicago"),
      method: "cash",
      reference: "",
      note: "",
      files: [PDF],
    });
    expect(paid.status, JSON.stringify(paid.body)).toBe(201);
    return paid.body;
  }

  it("A6 the server acts on saved payments: customer and supplier approval, the write-off limit, numbering", async () => {
    const grace = pay.accountant;
    await stepUp(grace);
    let rules = {
      approvalRequired: true,
      approvalThreshold: "10.00",
      writeOffMax: "5.00",
      paymentPrefix: "PAY-",
      refundPrefix: "RF-",
    };
    const save = async (patch: object) => {
      rules = { ...rules, ...patch };
      const response = await put("payments", grace.cookie, rules);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
    };
    await save({});
    const x = await payInvoice();
    const y = await payInvoice();
    const supplier = await billedSupplier();
    expect((await cardPayment(x.id, "50.00")).status).toBe("pending");
    expect((await supplierPayment(supplier, "50.00")).status).toBe("pending");
    await save({ approvalRequired: false });
    expect((await cardPayment(x.id, "1.00")).status).toBe("confirmed");
    expect((await supplierPayment(supplier, "1.00")).status).toBe("confirmed");
    await save({ writeOffMax: "0.01" });
    const writeOff = await call("post", `/invoices/${y.id}/write-off`, pay.owner.cookie).send({
      reason: "Small leftover after rounding",
    });
    expect(writeOff.status, JSON.stringify(writeOff.body)).toBe(400);
    expect(writeOff.body.message).toContain("Only balances up to");
    await save({ paymentPrefix: "RCV-" });
    expect((await cardPayment(y.id, "1.00")).number).toBe("RCV-0001");
  });

  it("A7 PUT /settings/expenses: the Owner without a step-up; the server applies the approval rule", async () => {
    const body = { approvalRequired: false, approvalThreshold: "" };
    for (const key of PRODUCT_ROLES.flooring) {
      const response = await put("expenses", people.get(`flooring:${key}`)!.cookie, SUMMIT.settings.expenses);
      if (key === "owner") expect(response.status, JSON.stringify(response.body)).toBe(200);
      else expect(outcome(response), key).toEqual([403, "forbidden"]);
    }
    for (const key of PRODUCT_ROLES.hr)
      expect(outcome(await put("expenses", people.get(`hr:${key}`)!.cookie, body)), key).toEqual([
        403,
        "module_not_enabled",
      ]);
    // Expenses are paid to a services vendor, made as expenses.int.test.ts makes one.
    const vendor = await withCompanyDb(payco, async (db) => {
      const address = { street: "1 Main St", city: "Denver", state: "CO", zip: "80202" };
      const [row] = await db
        .insert(suppliers)
        .values({ name: `Vendor ${uuidv7()}`, type: "services" as const, terms: "net_30" as const, address })
        .returning();
      return row.id;
    });
    const expense = () =>
      call("post", "/expenses", pay.owner.cookie).send({
        date: dayIn(new Date(), "America/Chicago"),
        supplierId: vendor,
        category: "supplies",
        locationId: pay.warehouse,
        amount: "150.00",
        tax: "",
        paymentMethod: "cash",
        reference: "",
        note: "",
        settlement: "paid",
        asDraft: false,
        files: [PDF],
      });
    await put("expenses", pay.owner.cookie, body).expect(200);
    const free = await expense();
    expect(free.status, JSON.stringify(free.body)).toBe(201);
    expect(free.body.status).not.toBe("pending");
    await put("expenses", pay.owner.cookie, { approvalRequired: true, approvalThreshold: "100.00" }).expect(200);
    const held = await expense();
    expect(held.status, JSON.stringify(held.body)).toBe(201);
    expect(held.body.status).toBe("pending");
  });

  it("A7b PUT /settings/expenses refuses an amount that is not plain money, with its words, and stores nothing", async () => {
    const owner = people.get("flooring:owner")!;
    const before = await rowOf(floorco, "expenses");
    const audits = await auditCount(floorco);
    for (const approvalThreshold of ["12.", "-5", "1e3", "abc", "12.345"])
      for (const approvalRequired of [true, false]) {
        const response = await put("expenses", owner.cookie, { approvalRequired, approvalThreshold });
        expect([...outcome(response), response.body.message], approvalThreshold).toEqual([
          400,
          "invalid_request",
          EXPENSE_MESSAGES.approvalThreshold,
        ]);
      }
    expect(outcome(await put("expenses", owner.cookie, { approvalRequired: true, approvalThreshold: 1000 }))).toEqual([
      400,
      "invalid_request",
    ]);
    expect(await rowOf(floorco, "expenses")).toEqual(before);
    expect(await auditCount(floorco)).toBe(audits);
  });

  /** Switches a feature off for one run, as imports.int.test.ts does. */
  async function withFeatureOff(key: FeatureKey, run: () => Promise<void>) {
    const feature = FEATURES[key] as { enabled: boolean };
    feature.enabled = false;
    try {
      await run();
    } finally {
      feature.enabled = true;
    }
  }

  it("A8 switches: a page's switch off answers its PUT 404; a product switch off hides its section from the read", async () => {
    const owner = people.get("flooring:owner")!;
    const bodies: Record<Served, unknown> = {
      profile: SUMMIT.settings.profile,
      numbers: numbersBody("minus"),
      payments: SUMMIT.settings.payments,
      expenses: SUMMIT.settings.expenses,
    };
    for (const section of SERVED) {
      await withFeatureOff(SETTINGS_SECTIONS[section].feature, async () => {
        expect((await put(section, owner.cookie, bodies[section])).status, section).toBe(404);
        const body = await answerOf(owner.cookie);
        if (section === "payments") expect(body).not.toHaveProperty("payments");
        else if (section === "expenses") expect(body).not.toHaveProperty("expenses");
        else expect(Object.keys(body).sort()).toEqual(["expenses", "numbers", "payments", "profile"]);
      });
    }
  });

  it("A9 data scope: each section's key below scope all is refused with the settings words, before any step-up, then allowed at all", async () => {
    for (const section of SERVED) {
      const roleKey = `branch-${section}`;
      const roleId = await withCompanyDb(floorco, async (db) => {
        const [role] = await db
          .insert(roles)
          .values({ key: roleKey, name: `Branch ${section}`, dataScope: "branch" as const })
          .returning();
        await db.insert(rolePermissions).values({ roleId: role.id, permissionKey: SETTINGS_SECTIONS[section].keys[0] });
        return role.id;
      });
      const person = await member(floorco, [roleKey], true);
      // The stored value sent back, so the save allowed at the end changes nothing another case reads.
      const stored = await rowOf(floorco, section);
      const body = section === "numbers" ? numbersToWire(stored as NumberSettings) : stored;
      const audits = await auditCount(floorco);
      const refused = await put(section, person.cookie, body);
      expect([refused.status, refused.body], section).toEqual([
        403,
        { code: "forbidden", message: SETTINGS_SCOPE_MESSAGE },
      ]);
      expect(await rowOf(floorco, section)).toEqual(stored);
      expect(await auditCount(floorco)).toBe(audits);
      await withCompanyDb(floorco, (db) => db.update(roles).set({ dataScope: "all" }).where(eq(roles.id, roleId)));
      if (section === "payments") {
        expect(outcome(await put(section, person.cookie, body)), section).toEqual([403, "step_up_required"]);
        await stepUp(person);
      }
      const saved = await put(section, person.cookie, body);
      expect(saved.status, `${section} ${JSON.stringify(saved.body)}`).toBe(200);
    }
  });

  it("A9b a module switched off below: payments and expenses refused and left out of the read", async () => {
    const owner = people.get("flooring:owner")!;
    await harness.control.db
      .insert(tenantModuleOverrides)
      .values({ tenantId: floorco.id, module: "core", enabled: false });
    try {
      expect(outcome(await put("payments", owner.cookie, SUMMIT.settings.payments))).toEqual([
        403,
        "module_not_enabled",
      ]);
      expect(outcome(await put("expenses", owner.cookie, SUMMIT.settings.expenses))).toEqual([
        403,
        "module_not_enabled",
      ]);
      expect(Object.keys(await answerOf(owner.cookie)).sort()).toEqual(["numbers", "profile"]);
    } finally {
      await harness.control.db.delete(tenantModuleOverrides).where(eq(tenantModuleOverrides.tenantId, floorco.id));
    }
    expect(Object.keys(await answerOf(owner.cookie)).sort()).toEqual(["expenses", "numbers", "payments", "profile"]);
    await put("expenses", owner.cookie, SUMMIT.settings.expenses).expect(200);
  });

  it("A10 a ceiling below the role binds the Owner too", async () => {
    const row = and(
      eq(tenantPermissionCeiling.tenantId, floorco.id),
      eq(tenantPermissionCeiling.permissionKey, "settings.numbers.manage"),
    );
    await harness.control.db.update(tenantPermissionCeiling).set({ allowed: false }).where(row);
    try {
      for (const key of ["owner", "accountant"])
        expect(outcome(await put("numbers", people.get(`flooring:${key}`)!.cookie, numbersBody("minus"))), key).toEqual(
          [403, "forbidden"],
        );
      await answerOf(people.get("flooring:owner")!.cookie);
    } finally {
      await harness.control.db.update(tenantPermissionCeiling).set({ allowed: true }).where(row);
    }
    await put("numbers", people.get("flooring:owner")!.cookie, numbersBody("minus")).expect(200);
  });

  it("A11 another company's user changes only their own company, whatever the request names", async () => {
    const otherOwner = await member(otherco, ["owner"]);
    const floorBefore = await rowOf(floorco, "numbers");
    await put("numbers", otherOwner.cookie, numbersBody("minus")).expect(200);
    expect((await rowOf(otherco, "numbers")) as NumberSettings).toMatchObject({ negativeStyle: "minus" });
    expect(await rowOf(floorco, "numbers")).toEqual(floorBefore);

    const email = await harness.addUser({ companyIds: [floorco.id, otherco.id], roles: ["owner"] });
    const both = await enrolled(email);
    await harness
      .post("/api/auth/organization/set-active")
      .set("Cookie", both.cookie)
      .send({ organizationId: floorco.id })
      .expect(200);
    const otherBefore = await rowOf(otherco, "numbers");
    await call("put", `/settings/numbers?companyId=${otherco.id}&tenantId=${otherco.id}`, both.cookie)
      .set("X-Company-Id", otherco.id)
      .set("X-Tenant-Id", otherco.id)
      .send(numbersBody("parens"))
      .expect(200);
    expect((await rowOf(floorco, "numbers")) as NumberSettings).toMatchObject({ negativeStyle: "parens" });
    expect(await rowOf(otherco, "numbers")).toEqual(otherBefore);
    expect((await answerOf(both.cookie)).numbers?.negativeStyle).toBe("parens");
    expect((await answerOf(otherOwner.cookie)).numbers?.negativeStyle).toBe("minus");
  });

  it("A12 refusals: a disabled member, an Owner without a factor, the wrong product", async () => {
    const disabled = await member(floorco, ["owner"]);
    const userId = await harness.userIdOf(disabled.email);
    await withCompanyDb(floorco, (db) =>
      db.update(userProfiles).set({ status: "disabled" }).where(eq(userProfiles.userId, userId)),
    );
    const read = await call("get", "/settings", disabled.cookie);
    expect(read.body).toEqual({ code: "forbidden", message: PERMISSION_REFUSALS.forbidden });
    expect(read.status).toBe(403);
    expect(outcome(await put("numbers", disabled.cookie, numbersBody("minus")))).toEqual([403, "forbidden"]);

    const noFactor = await member(floorco, ["owner"], false);
    expect(outcome(await call("get", "/settings", noFactor.cookie))).toEqual([403, "mfa_enrolment_required"]);
    expect(outcome(await put("numbers", noFactor.cookie, numbersBody("minus")))).toEqual([
      403,
      "mfa_enrolment_required",
    ]);

    const owner = people.get("flooring:owner")!;
    const wrongHost = await call("get", "/settings", owner.cookie).set(PRODUCT_HEADER, "hr");
    expect(outcome(wrongHost)).toEqual([403, "product_not_enabled"]);
  });

  it("A13 /settings/accounting still answers beside the new routes", async () => {
    const grace = people.get("flooring:accountant")!;
    const read = await call("get", "/settings/accounting", grace.cookie);
    expect(read.status, JSON.stringify(read.body)).toBe(200);
    const saved = await call("put", "/settings/accounting", grace.cookie).send(read.body);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  });

  it("A14 two saves at once: both answered, both audited in order, the later one stored", async () => {
    const owner = people.get("flooring:owner")!;
    // A third value first, so neither save's `after` can equal what both would read without the lock.
    await put("numbers", owner.cookie, { ...numbersBody("minus"), compactDashboards: false }).expect(200);
    const audits = (await auditsOf(floorco, "Changed number format")).length;
    // Hold the row while both saves start, so both reach their read of it before either writes:
    // without the save's own row lock, both would read the same `before`.
    const saves = await withCompanyDb(floorco, (db) =>
      db.transaction(async (tx) => {
        await tx.select({ id: settings.id }).from(settings).where(eq(settings.group, "numbers")).for("update");
        const both = Promise.all([
          put("numbers", owner.cookie, numbersBody("parens")).then((response) => response),
          put("numbers", owner.cookie, numbersBody("minus")).then((response) => response),
        ]);
        await new Promise((resolve) => setTimeout(resolve, 750));
        return { both };
      }),
    );
    const [first, second] = await saves.both;
    expect([first.status, second.status]).toEqual([200, 200]);
    const entries = (await auditsOf(floorco, "Changed number format")).slice(audits);
    expect(entries).toHaveLength(2);
    expect(entries[1].before).toEqual(entries[0].after);
    expect(numbersToWire((await rowOf(floorco, "numbers")) as NumberSettings)).toEqual(entries[1].after);
  });

  it("A15 the number format keeps the company's own locale and currency", async () => {
    const owner = people.get("flooring:owner")!;
    const french = await put("numbers", owner.cookie, { ...numbersBody("minus"), locale: "fr-FR" });
    expect(outcome(french)).toEqual([400, "invalid_request"]);
    expect(french.body.message).toContain("en-US, USD");
    const euros = await put("numbers", owner.cookie, { ...numbersBody("minus"), currency: "EUR" });
    expect(outcome(euros)).toEqual([400, "invalid_request"]);
    expect(euros.body.message).toContain("en-US, USD");

    // A stored format that is not the default (rule 12): the rule compares with the company's own row,
    // so a Canadian company keeps en-CA and can't switch to the en-US default.
    const canadian: NumberSettings = { ...SUMMIT.settings.numbers, locale: "en-CA" };
    await withCompanyDb(otherco, (db) =>
      db.update(settings).set({ value: canadian }).where(eq(settings.group, "numbers")),
    );
    const otherOwner = await member(otherco, ["owner"]);
    const kept = await put("numbers", otherOwner.cookie, numbersBody("parens", canadian));
    expect(kept.status, JSON.stringify(kept.body)).toBe(200);
    expect(await rowOf(otherco, "numbers")).toEqual({ ...canadian, negativeStyle: "parens" });
    const american = await put("numbers", otherOwner.cookie, numbersBody("minus"));
    expect(outcome(american)).toEqual([400, "invalid_request"]);
    expect(american.body.message).toContain("(en-CA, USD)");
    expect(await rowOf(otherco, "numbers")).toEqual({ ...canadian, negativeStyle: "parens" });

    await withCompanyDb(bareco, (db) => db.delete(settings).where(eq(settings.group, "numbers")));
    const bare = await member(bareco, ["owner"]);
    const defaults: NumberSettingsWire = numbersToWire(defaultNumberSettings());
    const unsaved = await put("numbers", bare.cookie, { ...defaults, locale: "fr-FR" });
    expect(outcome(unsaved)).toEqual([400, "invalid_request"]);
    expect(unsaved.body.message).toContain(`${defaultNumberSettings().locale}, ${defaultNumberSettings().currency}`);
    expect(await rowOf(bareco, "numbers")).toBeUndefined();
  });
});
