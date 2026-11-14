import {
  auditLog,
  branches,
  expenses as expenseTable,
  locations,
  paymentAllocations,
  paymentsMade,
  settings,
  supplierBills,
  suppliers,
  userProfiles,
} from "@workspace/db/company";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import { dec, moneyString } from "@workspace/shared";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RecurringExpensesJob } from "../src/modules/finance/recurring-expenses.job";
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

/** A day shifted by whole calendar days, as yyyy-MM-dd. */
function shiftDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The first day of the month `months` before the given day. */
function firstOfMonthsAgo(day: string, months: number): string {
  const [year, month] = day.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(year, month - 1 - months, 1)).toISOString().slice(0, 10);
}

const PDF = { name: "receipt.pdf", data: Buffer.from("%PDF-1.4\n% rent receipt\n").toString("base64") };

interface TrialBalance {
  balanced: boolean;
  rows: { key: string | null; balance: string }[];
}

interface ExpenseBody {
  id: string;
  number: string;
  status: string;
  amount: string;
  tax: string;
  locationId: string | null;
  billId: string | null;
  rejectReason: string | null;
  recordedBy: string;
  recurringId: string | null;
  files: { id: string; name: string; type: string; size: number }[];
}

/**
 * Finance → Expenses API (finance-expenses.md; P12 part 2; ADR 0041): recording, approval, voids,
 * pay-later bills, postings, data scope, receipts and recurring drafts.
 */
describe("expenses API (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let supplierId = "";
  let locationA = "";
  let locationB = "";
  let branchA = "";
  let ownerId = "";
  const cookies = { owner: "", accountant: "", manager: "", sales: "" };

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

  /** The form's body for a rent expense of 40.00 with a receipt, with fields overridden. */
  function form(over: Record<string, unknown> = {}) {
    return {
      date: companyDay(),
      supplierId,
      category: "rent",
      locationId: locationA,
      amount: "40.00",
      tax: "",
      paymentMethod: "cash",
      reference: "",
      note: "",
      settlement: "paid",
      asDraft: false,
      files: [PDF],
      ...over,
    };
  }

  async function record(cookie: string, over: Record<string, unknown> = {}): Promise<ExpenseBody> {
    return (await call("post", "/expenses", cookie).send(form(over)).expect(201)).body;
  }

  async function balances(): Promise<Map<string, string>> {
    const body = (await call("get", "/ledger/trial-balance", cookies.owner).expect(200)).body as TrialBalance;
    expect(body.balanced).toBe(true);
    return new Map(body.rows.flatMap((row) => (row.key ? [[row.key, row.balance] as const] : [])));
  }

  /** How much an account's balance (debits less credits) moved between two readings. */
  function moved(before: Map<string, string>, after: Map<string, string>, key: string): string {
    return moneyString(dec(after.get(key) ?? "0").minus(before.get(key) ?? "0"));
  }

  async function listed(cookie: string): Promise<ExpenseBody[]> {
    return (await call("get", "/expenses", cookie).expect(200)).body;
  }

  async function rows<T>(read: (db: Awaited<ReturnType<typeof harness.companyDb>>["db"]) => Promise<T>): Promise<T> {
    const handle = await harness.companyDb(company.id);
    try {
      return await read(handle.db);
    } finally {
      await handle.close();
    }
  }

  async function fileBytes(cookie: string, id: string) {
    return call("get", `/files/${id}`, cookie)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () => done(null, Buffer.concat(chunks)));
      });
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("exp");
    await rows(async (db) => {
      const [a] = await db.insert(branches).values({ name: "Denver", city: "Denver", state: "CO" }).returning();
      const [b] = await db.insert(branches).values({ name: "Austin", city: "Austin", state: "TX" }).returning();
      const address = { street: "1 Main St", city: "Denver", state: "CO", zip: "80202" };
      const [storeA] = await db
        .insert(locations)
        .values({ name: "Denver warehouse", kind: "warehouse" as const, branchId: a.id, address, isDefault: true })
        .returning();
      const [storeB] = await db
        .insert(locations)
        .values({ name: "Austin warehouse", kind: "warehouse" as const, branchId: b.id, address })
        .returning();
      const [supplier] = await db
        .insert(suppliers)
        .values({ name: "Harbor Property Co", type: "services" as const, terms: "net_30" as const, address })
        .returning();
      await db.insert(settings).values({
        group: "expenses",
        value: { approvalRequired: true, approvalThreshold: "100.00" },
      });
      branchA = a.id;
      locationA = storeA.id;
      locationB = storeB.id;
      supplierId = supplier.id;
    });
    const emails = {
      owner: await harness.addUser({ companyIds: [company.id], roles: ["owner"] }),
      accountant: await harness.addUser({ companyIds: [company.id], roles: ["accountant"] }),
      manager: await harness.addUser({ companyIds: [company.id], roles: ["manager"] }),
      sales: await harness.addUser({ companyIds: [company.id], roles: ["sales"] }),
    };
    ownerId = await harness.userIdOf(emails.owner);
    const managerId = await harness.userIdOf(emails.manager);
    await rows((db) => db.update(userProfiles).set({ branchId: branchA }).where(eq(userProfiles.userId, managerId)));
    cookies.owner = await enrolled(emails.owner);
    cookies.accountant = await enrolled(emails.accountant);
    cookies.manager = await harness.signIn(emails.manager);
    cookies.sales = await harness.signIn(emails.sales);
  }, 120_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("refuses the unauthenticated and a role without finance keys, and lets a permitted one list", async () => {
    expect(
      (await request(harness.app.getHttpServer()).get("/expenses").set("X-Forwarded-Host", "localhost:3000")).status,
    ).toBe(401);
    expect((await call("get", "/expenses", cookies.sales)).status).toBe(403);
    expect((await call("get", "/recurring-expenses", cookies.sales)).status).toBe(403);
    expect((await call("post", "/expenses", cookies.sales).send(form())).status).toBe(403);
    expect((await call("get", "/expenses", cookies.accountant)).status).toBe(200);
    expect((await call("get", "/recurring-expenses", cookies.accountant)).status).toBe(200);
  });

  it("saves a draft without a receipt, and refuses recording without one, a future date and payroll", async () => {
    const draft = await record(cookies.accountant, { asDraft: true, files: [], supplierId: null, amount: "10.00" });
    expect(draft.status).toBe("draft");
    expect(draft.files).toEqual([]);
    const bare = await call("post", "/expenses", cookies.accountant).send(form({ files: [] }));
    expect(bare.status).toBe(400);
    expect(bare.body.code).toBe("invalid_request");
    expect(bare.body.message).toContain("Attach the receipt");
    const future = await call("post", "/expenses", cookies.accountant).send(form({ date: shiftDays(companyDay(), 1) }));
    expect(future.status).toBe(400);
    expect(future.body.message).toContain("future");
    const payroll = await call("post", "/expenses", cookies.accountant).send(form({ category: "payroll" }));
    expect(payroll.status).toBe(400);
    expect(payroll.body.message).toContain("category");
  });

  it("confirms an expense under the threshold, posts category debit and cash credit, and audits it", async () => {
    const before = await balances();
    const saved = await record(cookies.accountant, { amount: "40.00", tax: "2.50" });
    expect(saved.status).toBe("confirmed");
    expect(saved.number).toMatch(/^EXP-/);
    const after = await balances();
    expect(moved(before, after, "rent")).toBe("42.50");
    expect(moved(before, after, "cash")).toBe("-42.50");
    const audit = await rows((db) =>
      db
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.action, "Recorded expense"), eq(auditLog.targetId, saved.id))),
    );
    expect(audit).toHaveLength(1);
  });

  it("holds an expense above the threshold, bars its recorder, and posts on another person's approval", async () => {
    const before = await balances();
    const pending = await record(cookies.owner, { category: "supplies", amount: "150.00" });
    expect(pending.status).toBe("pending");
    expect(moved(before, await balances(), "supplies")).toBe("0.00");
    const own = await call("post", `/expenses/${pending.id}/review`, cookies.owner).send({ action: "approve" });
    expect(own.status).toBe(400);
    expect(own.body.message).toContain("Someone else");
    const approved = await call("post", `/expenses/${pending.id}/review`, cookies.accountant)
      .send({ action: "approve" })
      .expect(201);
    expect(approved.body.status).toBe("confirmed");
    expect(moved(before, await balances(), "supplies")).toBe("150.00");

    const second = await record(cookies.owner, { category: "supplies", amount: "150.00" });
    const short = await call("post", `/expenses/${second.id}/review`, cookies.accountant).send({
      action: "reject",
      reason: "no",
    });
    expect(short.status).toBe(400);
    const rejected = await call("post", `/expenses/${second.id}/review`, cookies.accountant)
      .send({ action: "reject", reason: "Wrong vendor" })
      .expect(201);
    expect(rejected.body.status).toBe("draft");
    expect(rejected.body.rejectReason).toBe("Wrong vendor");
  });

  it("finishes a draft with a receipt, and refuses to edit a recorded expense", async () => {
    const draft = await record(cookies.accountant, { asDraft: true });
    const before = await balances();
    const finished = await call("put", `/expenses/${draft.id}`, cookies.accountant)
      .send(form({ files: [PDF] }))
      .expect(200);
    expect(finished.body.status).toBe("confirmed");
    expect(finished.body.files).toHaveLength(2);
    expect(moved(before, await balances(), "rent")).toBe("40.00");
    const edit = await call("put", `/expenses/${draft.id}`, cookies.accountant).send(form({ amount: "45.00" }));
    expect(edit.status).toBe(400);
    expect(edit.body.message).toContain("can't be edited");
  });

  it("finishes a draft that already holds its receipt without sending the file again", async () => {
    const draft = await record(cookies.accountant, { asDraft: true });
    const finished = await call("put", `/expenses/${draft.id}`, cookies.accountant).send(form({ files: [] }));
    expect(finished.status).toBe(200);
    expect(finished.body.status).toBe("confirmed");
    expect(finished.body.files).toHaveLength(1);
  });

  it("raises a supplier bill for a pay-later expense and credits accounts payable, not cash", async () => {
    const before = await balances();
    const saved = await record(cookies.accountant, { settlement: "on_account", amount: "80.00", tax: "5.00" });
    expect(saved.status).toBe("confirmed");
    expect(saved.billId).not.toBeNull();
    const bills = await rows((db) => db.select().from(supplierBills).where(eq(supplierBills.id, saved.billId!)));
    expect(bills).toHaveLength(1);
    expect(bills[0]!.number).toBe(saved.number);
    expect(bills[0]!.total).toBe("85.00");
    const after = await balances();
    expect(moved(before, after, "accounts_payable")).toBe("-85.00");
    expect(moved(before, after, "cash")).toBe("0.00");
    expect(moved(before, after, "rent")).toBe("85.00");
  });

  it("voids with a reason, posts the reversal and retires a pay-later bill", async () => {
    const before = await balances();
    const plain = await record(cookies.accountant, { amount: "30.00" });
    const later = await record(cookies.accountant, { settlement: "on_account", amount: "20.00" });
    expect((await call("post", `/expenses/${plain.id}/void`, cookies.accountant).send({ reason: "x" })).status).toBe(
      400,
    );
    const voided = await call("post", `/expenses/${plain.id}/void`, cookies.accountant)
      .send({ reason: "Entered twice" })
      .expect(201);
    expect(voided.body.status).toBe("voided");
    await call("post", `/expenses/${later.id}/void`, cookies.accountant).send({ reason: "Entered twice" }).expect(201);
    const after = await balances();
    expect(moved(before, after, "rent")).toBe("0.00");
    expect(moved(before, after, "cash")).toBe("0.00");
    expect(moved(before, after, "accounts_payable")).toBe("0.00");
    const [bill] = await rows((db) => db.select().from(supplierBills).where(eq(supplierBills.id, later.billId!)));
    expect(bill!.deletedAt).not.toBeNull();
    const again = await call("post", `/expenses/${plain.id}/void`, cookies.accountant).send({ reason: "Again" });
    expect(again.status).toBe(400);
  });

  it("refuses to void a pay-later expense whose bill has a live supplier payment", async () => {
    const later = await record(cookies.accountant, { settlement: "on_account", amount: "60.00" });
    const paymentId = uuidv7();
    await rows(async (db) => {
      await db.insert(paymentsMade).values({
        id: paymentId,
        number: `PM-${uuidv7()}`,
        supplierId,
        date: companyDay(),
        method: "check",
        amount: "60.00",
        status: "confirmed",
        recordedById: ownerId,
        recordedAt: new Date(),
      });
      await db.insert(paymentAllocations).values({ paymentId, billId: later.billId!, amount: "60.00" });
    });
    const refused = await call("post", `/expenses/${later.id}/void`, cookies.accountant).send({ reason: "Mistake" });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("payment to its supplier");
    // A voided supplier payment no longer blocks the void.
    await rows((db) => db.update(paymentsMade).set({ status: "voided" }).where(eq(paymentsMade.id, paymentId)));
    await call("post", `/expenses/${later.id}/void`, cookies.accountant).send({ reason: "Mistake" }).expect(201);
  });

  it("stores a sales tax payment company-wide with no tax and debits sales tax payable", async () => {
    const before = await balances();
    const saved = await record(cookies.accountant, {
      category: "sales_tax_payment",
      locationId: locationA,
      amount: "70.00",
      tax: "5.00",
    });
    expect(saved.locationId).toBeNull();
    expect(saved.tax).toBe("0.00");
    const after = await balances();
    expect(moved(before, after, "sales_tax_payable")).toBe("70.00");
    expect(moved(before, after, "cash")).toBe("-70.00");
  });

  it("limits a branch-scoped reader to their branch's and their own expenses and receipts", async () => {
    const inBranch = await record(cookies.accountant, { locationId: locationA });
    const elsewhere = await record(cookies.accountant, { locationId: locationB });
    const companyWide = await record(cookies.accountant, { locationId: null });
    const mine = await record(cookies.manager, { locationId: locationA, amount: "20.00" });
    const seen = new Set((await listed(cookies.manager)).map((row) => row.id));
    expect(seen.has(inBranch.id)).toBe(true);
    expect(seen.has(mine.id)).toBe(true);
    expect(seen.has(elsewhere.id)).toBe(false);
    expect(seen.has(companyWide.id)).toBe(false);
    expect((await fileBytes(cookies.manager, elsewhere.files[0]!.id)).status).toBe(404);
    expect((await fileBytes(cookies.manager, companyWide.files[0]!.id)).status).toBe(404);
    expect((await fileBytes(cookies.manager, inBranch.files[0]!.id)).status).toBe(200);
    expect(
      (await call("post", `/expenses/${elsewhere.id}/void`, cookies.manager).send({ reason: "Nope" })).status,
    ).toBe(403);
  });

  it("returns receipt metadata in the list and the stored bytes to an in-scope reader", async () => {
    const saved = await record(cookies.accountant, { locationId: locationA });
    const row = (await listed(cookies.accountant)).find((candidate) => candidate.id === saved.id)!;
    expect(row.files).toHaveLength(1);
    expect(row.files[0]).toMatchObject({ name: "receipt.pdf", type: "application/pdf" });
    const file = await fileBytes(cookies.manager, row.files[0]!.id);
    expect(file.status).toBe(200);
    expect((file.body as Buffer).toString()).toBe(Buffer.from(PDF.data, "base64").toString());
  });

  it("posts cash to the bank account that claims the payment method", async () => {
    const bank = await call("put", "/settings/accounting", cookies.accountant)
      .send({
        costingMethod: "average",
        salesTaxBasis: "accrual",
        bankAccounts: [{ name: "Operating", methods: ["check"] }],
      })
      .expect(200);
    const key = (bank.body.bankAccounts as { key: string }[])[0]!.key;
    const before = await balances();
    await record(cookies.accountant, { paymentMethod: "check", amount: "55.00" });
    const after = await balances();
    expect(moved(before, after, key)).toBe("-55.00");
    expect(moved(before, after, "cash")).toBe("0.00");
  });

  it("raises one draft per owed period from a recurring template, once, and the job adds none", async () => {
    const today = companyDay();
    const startsOn = firstOfMonthsAgo(today, 3);
    const body = {
      supplierId,
      category: "rent",
      locationId: locationA,
      amount: "900.00",
      tax: "",
      paymentMethod: "check",
      frequency: "monthly",
      dayOfMonth: 1,
      startsOn,
      endsOn: null,
      active: true,
      note: "Lease",
    };
    const template = await call("post", "/recurring-expenses", cookies.accountant).send(body).expect(201);
    const drafts = async () => (await listed(cookies.accountant)).filter((row) => row.recurringId === template.body.id);
    const first = await drafts();
    // Day 1 of the start month through the current month is four periods.
    expect(first).toHaveLength(4);
    expect(first.every((row) => row.status === "draft" && row.recordedBy === "Recurring expense")).toBe(true);
    await call("put", `/recurring-expenses/${template.body.id}`, cookies.accountant).send(body).expect(200);
    expect(await drafts()).toHaveLength(4);
    await harness.app.get(RecurringExpensesJob).runAll();
    expect(await drafts()).toHaveLength(4);
    const stored = await rows((db) =>
      db.select({ id: expenseTable.id }).from(expenseTable).where(eq(expenseTable.recurringId, template.body.id)),
    );
    expect(stored).toHaveLength(4);
    // Each raised draft is audited as the system's (CLAUDE.md rule 10).
    const audited = await rows((db) =>
      db.select().from(auditLog).where(eq(auditLog.action, "Raised recurring expense draft")),
    );
    expect(audited.filter((row) => stored.some((draft) => draft.id === row.targetId))).toHaveLength(4);
    expect(audited.every((row) => row.actorUserId === null)).toBe(true);
  });

  it("refuses a branch-scoped writer outside their branch, company-wide, and on templates (PR #20 review)", async () => {
    const other = await call("post", "/expenses", cookies.manager).send(form({ locationId: locationB }));
    expect(other.status).toBe(403);
    expect((await call("post", "/expenses", cookies.manager).send(form({ locationId: null }))).status).toBe(403);
    const tax = form({ category: "sales_tax_payment", locationId: locationA });
    expect((await call("post", "/expenses", cookies.manager).send(tax)).status).toBe(403);
    const draft = await record(cookies.manager, { asDraft: true, files: [] });
    expect(
      (await call("put", `/expenses/${draft.id}`, cookies.manager).send(form({ asDraft: true, locationId: locationB })))
        .status,
    ).toBe(403);
    const template = {
      supplierId,
      category: "rent",
      locationId: locationA,
      amount: "100.00",
      tax: "",
      paymentMethod: "ach",
      frequency: "monthly",
      dayOfMonth: 1,
      startsOn: companyDay(),
      endsOn: null,
      active: true,
      note: "",
    };
    expect((await call("post", "/recurring-expenses", cookies.manager).send(template)).status).toBe(403);
  });

  it("keeps payroll months from readers without hr.payroll.view", async () => {
    const id = uuidv7();
    await rows((db) =>
      db.insert(expenseTable).values({
        id,
        number: `PAY-${id.slice(-6)}`,
        date: companyDay(),
        category: "payroll" as const,
        locationId: locationA,
        amount: "5000.00",
        paymentMethod: "ach" as const,
        status: "confirmed" as const,
        settlement: "paid" as const,
        recordedById: ownerId,
        recordedAt: new Date(),
      }),
    );
    expect((await listed(cookies.manager)).some((row) => row.id === id)).toBe(false);
    expect((await call("post", `/expenses/${id}/review`, cookies.manager).send({ action: "approve" })).status).toBe(
      404,
    );
  });

  it("takes a receipt of about 1 MB on POST and PUT", async () => {
    const big = {
      name: "scan.pdf",
      data: Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(1_000_000, 32)]).toString("base64"),
    };
    const draft = await record(cookies.accountant, { asDraft: true, files: [big] });
    expect(draft.files).toHaveLength(1);
    const finished = await call("put", `/expenses/${draft.id}`, cookies.accountant)
      .send(form({ files: [big] }))
      .expect(200);
    expect(finished.body.files).toHaveLength(2);
  });

  it("refuses a goods-only or inactive vendor (spec rule 10, checked on the server)", async () => {
    const address = { street: "2 Mill Rd", city: "Denver", state: "CO", zip: "80202" };
    const [goods, retired] = await rows((db) =>
      db
        .insert(suppliers)
        .values([
          { name: "Mill Goods Co", type: "goods" as const, terms: "net_30" as const, address },
          {
            name: "Old Cleaning Co",
            type: "services" as const,
            status: "inactive" as const,
            terms: "net_30" as const,
            address,
          },
        ])
        .returning(),
    );
    for (const vendor of [goods!, retired!]) {
      const refused = await call("post", "/expenses", cookies.accountant).send(form({ supplierId: vendor.id }));
      expect(refused.status).toBe(400);
    }
  });
});
