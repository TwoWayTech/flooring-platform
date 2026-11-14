import { auditLog, branches, customers, locations, paymentsMade, suppliers, userProfiles } from "@workspace/db/company";
import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import { dec, moneyString } from "@workspace/shared";
import { and, eq } from "drizzle-orm";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthHarness, PASSWORD, sessionCookie } from "./auth-harness";

const PDF = { name: "terms.pdf", data: Buffer.from("%PDF-1.4\n% terms\n").toString("base64") };

type Who = "owner" | "manager" | "sales" | "accountant" | "warehouse" | "otherManager";

interface Json {
  [key: string]: unknown;
}

describe("contracts register (contracts part 1)", () => {
  const harness = new AuthHarness();
  let company = { id: "", slug: "" };
  let other = { id: "", slug: "" };
  let supplierId = "";
  let customerId = "";
  let locationA = "";
  let branchA = "";
  let branchB = "";
  const cookies: Record<Who, string> = {
    owner: "",
    manager: "",
    sales: "",
    accountant: "",
    warehouse: "",
    otherManager: "",
  };

  function call(method: "get" | "post" | "put", path: string, who: Who) {
    return request(harness.app.getHttpServer())
      [method](path)
      .set("X-Forwarded-Host", "localhost:3000")
      .set("Cookie", cookies[who]);
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

  function line(over: Json = {}) {
    return {
      code: "L1",
      description: "Tile",
      category: "labor",
      billing: "percent",
      scheduledValue: "1000.00",
      retainagePct: null,
      storedRetainagePct: null,
      milestoneDueAt: null,
      estimatedCost: "600.00",
      ...over,
    };
  }

  /** A subcontract project by default, as the smoke flow builds it. */
  function form(over: Json = {}) {
    return {
      direction: "subcontractor",
      kind: "project",
      customerId: null,
      supplierId,
      title: "Lobby tile",
      scope: "Tile",
      branchId: branchA,
      locationId: locationA,
      jobSite: { street: "1 Main", city: "Denver", state: "CO", zip: "80202" },
      startsAt: "2026-11-01",
      endsAt: "2027-02-01",
      renewal: { mode: "none", noticeDays: 30 },
      retainagePct: "5",
      storedRetainagePct: "5",
      bondInLieu: false,
      taxTreatment: "on_billing",
      notes: "",
      lines: [line()],
      ...over,
    };
  }

  function customerForm(over: Json = {}) {
    return form({ direction: "customer", customerId, supplierId: null, title: "Customer job", ...over });
  }

  async function create(who: Who, body: Json = form()): Promise<Json> {
    const response = await call("post", "/contracts", who).send(body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Json;
  }

  async function send(who: Who, id: string) {
    const response = await call("post", `/contracts/${id}/send`, who);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return response.body as Json;
  }

  /** Draft, sent, signed: an active contract. */
  async function activate(body: Json = form()): Promise<string> {
    const made = await create("owner", body);
    await send("owner", made.id as string);
    const signed = await call("post", `/contracts/${made.id}/sign`, "owner").send({
      signerName: "Alex Crew",
      signerRole: "Owner",
    });
    expect(signed.status, JSON.stringify(signed.body)).toBe(201);
    return made.id as string;
  }

  async function linesOf(id: string, who: Who = "owner"): Promise<Json[]> {
    const response = await call("get", "/contract-lines", who).expect(200);
    return (response.body as Json[]).filter((l) => l.contractId === id);
  }

  async function auditActions(id: string): Promise<string[]> {
    const handle = await harness.companyDb(company.id);
    try {
      const rows = await handle.db
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.targetType, "contract"), eq(auditLog.targetId, id)));
      return rows.map((r) => r.action);
    } finally {
      await handle.close();
    }
  }

  beforeAll(async () => {
    await harness.start();
    company = await harness.provisionCompany("ctr");
    other = await harness.provisionCompany("ctrother");
    const handle = await harness.companyDb(company.id);
    try {
      const db = handle.db;
      const [a] = await db.insert(branches).values({ name: "Denver", city: "Denver", state: "CO" }).returning();
      const [b] = await db.insert(branches).values({ name: "Austin", city: "Austin", state: "TX" }).returning();
      const address = { street: "1 Main St", city: "Denver", state: "CO", zip: "80202" };
      const [store] = await db
        .insert(locations)
        .values({ name: "Denver warehouse", kind: "warehouse" as const, branchId: a!.id, address, isDefault: true })
        .returning();
      const [supplier] = await db
        .insert(suppliers)
        .values({
          name: "Tile Crew",
          type: "services" as const,
          terms: "net_30" as const,
          address,
          email: "crew@example.test",
        })
        .returning();
      const [customer] = await db
        .insert(customers)
        .values({ type: "contractor" as const, name: "Builder", terms: "net_30" as const, email: "b@example.test" })
        .returning();
      branchA = a!.id;
      branchB = b!.id;
      locationA = store!.id;
      supplierId = supplier!.id;
      customerId = customer!.id;
    } finally {
      await handle.close();
    }
    const emails = {
      owner: await harness.addUser({ companyIds: [company.id], roles: ["owner"] }),
      manager: await harness.addUser({ companyIds: [company.id], roles: ["manager"] }),
      sales: await harness.addUser({ companyIds: [company.id], roles: ["sales"] }),
      accountant: await harness.addUser({ companyIds: [company.id], roles: ["accountant"] }),
      warehouse: await harness.addUser({ companyIds: [company.id], roles: ["warehouse"] }),
      otherManager: await harness.addUser({ companyIds: [other.id], roles: ["manager"] }),
    };
    const handle2 = await harness.companyDb(company.id);
    try {
      for (const key of ["manager", "sales"] as const) {
        const id = await harness.userIdOf(emails[key]);
        await handle2.db.update(userProfiles).set({ branchId: branchA }).where(eq(userProfiles.userId, id));
      }
      const salesId = await harness.userIdOf(emails.sales);
      await handle2.db.update(customers).set({ salesRepId: salesId }).where(eq(customers.id, customerId));
    } finally {
      await handle2.close();
    }
    cookies.owner = await enrolled(emails.owner);
    cookies.accountant = await enrolled(emails.accountant);
    cookies.manager = await harness.signIn(emails.manager);
    cookies.sales = await harness.signIn(emails.sales);
    cookies.warehouse = await harness.signIn(emails.warehouse);
    cookies.otherManager = await harness.signIn(emails.otherManager);
  }, 180_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("answers 401 without a session and 403 per the permission table", async () => {
    const anonymous = await request(harness.app.getHttpServer())
      .get("/contracts")
      .set("X-Forwarded-Host", "localhost:3000");
    expect(anonymous.status).toBe(401);

    // Warehouse holds no contracts permission at all.
    expect((await call("get", "/contracts", "warehouse")).status).toBe(403);
    expect((await call("get", "/contract-lines", "warehouse")).status).toBe(403);
    expect((await call("post", "/contracts", "warehouse").send(form())).status).toBe(403);

    // Accountant views (all scope) but can't create or edit.
    expect((await call("get", "/contracts", "accountant")).status).toBe(200);
    expect((await call("get", "/lien-waivers", "accountant")).status).toBe(200);
    expect((await call("post", "/contracts", "accountant").send(form())).status).toBe(403);

    // Sales: contracts yes, compliance no, approve no.
    expect((await call("get", "/contracts", "sales")).status).toBe(200);
    expect((await call("get", "/lien-waivers", "sales")).status).toBe(403);
    expect((await call("get", "/insurance-certificates", "sales")).status).toBe(403);

    const made = await create("owner");
    const id = made.id as string;
    await send("owner", id);
    expect(
      (await call("post", `/contracts/${id}/sign`, "sales").send({ signerName: "Alex Crew", signerRole: "" })).status,
    ).toBe(403);
    expect((await call("post", `/contracts/${id}/terminate`, "sales").send({ reason: "Cancelled" })).status).toBe(403);
    expect((await call("post", `/contracts/${id}/send`, "accountant")).status).toBe(403);
    expect(
      (
        await call("post", `/contracts/${id}/lien-waivers`, "sales").send({
          type: "conditional_final",
          paymentId: null,
          supplierPaymentId: null,
          amount: "10.00",
          throughDate: "2026-11-10",
          statutoryForm: false,
        })
      ).status,
    ).toBe(403);
    expect(
      (await call("post", `/change-orders/${uuidv7()}/decision`, "sales").send({ action: "approve", reason: "" }))
        .status,
    ).toBe(403);
  });

  it("creates a project draft whose originalValue is the sum of its lines, and a master forced to zero", async () => {
    const project = await create(
      "owner",
      form({ lines: [line({ code: "L1" }), line({ code: "L2", description: "Grout", scheduledValue: "250.50" })] }),
    );
    expect(project.number).toMatch(/^CTR-\d{4}$/);
    expect(project.status).toBe("draft");
    expect(project.originalValue).toBe("1250.50");
    expect(project.retainagePct).toMatch(/^5(\.0+)?$/);
    expect((await linesOf(project.id as string)).map((l) => l.code).sort()).toEqual(["L1", "L2"]);

    const master = await create("owner", customerForm({ kind: "master", title: "Master terms" }));
    expect(master.number).toBe(`CTR-${Number((project.number as string).slice(4)) + 1}`);
    expect(master.originalValue).toBe("0.00");
    expect(master.retainagePct).toMatch(/^0(\.0+)?$/);
    expect(master.storedRetainagePct).toMatch(/^0(\.0+)?$/);
    expect(await linesOf(master.id as string)).toEqual([]);

    // Validation: one error body.
    const noTitle = await call("post", "/contracts", "owner").send(form({ title: "  " }));
    expect(noTitle.status).toBe(400);
    expect(noTitle.body.code).toBe("invalid_request");
    expect(typeof noTitle.body.message).toBe("string");
    expect((await call("post", "/contracts", "owner").send(customerForm({ customerId: null }))).status).toBe(400);
    expect((await call("post", "/contracts", "owner").send(form({ supplierId: null }))).status).toBe(400);
    expect((await call("post", "/contracts", "owner").send(form({ locationId: uuidv7() }))).status).toBe(400);
    expect(
      (await call("post", "/contracts", "owner").send(form({ lines: [line({ scheduledValue: "12.345" })] }))).status,
    ).toBe(400);
    expect((await call("post", "/contracts", "owner").send(form({ retainagePct: "101" }))).status).toBe(400);
    expect((await call("post", "/contracts", "owner").send({ ...form(), surprise: true })).status).toBe(400);
  });

  it("edits only while draft, replacing the lines", async () => {
    const made = await create("owner");
    const id = made.id as string;
    const edited = await call("put", `/contracts/${id}`, "owner").send(
      form({
        title: "Renamed",
        lines: [line({ code: "N1", scheduledValue: "300.00" }), line({ code: "N2", scheduledValue: "200.00" })],
      }),
    );
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    expect(edited.body.title).toBe("Renamed");
    expect(edited.body.originalValue).toBe("500.00");
    expect((await linesOf(id)).map((l) => l.code).sort()).toEqual(["N1", "N2"]);

    await send("owner", id);
    const locked = await call("put", `/contracts/${id}`, "owner").send(form());
    expect(locked.status).toBe(400);
    expect(locked.body.code).toBe("invalid_request");
    expect(locked.body.message).toMatch(/draft/i);

    await call("post", `/contracts/${id}/recall`, "owner").expect(201);
    expect((await call("put", `/contracts/${id}`, "owner").send(form({ title: "Again" }))).status).toBe(200);
  });

  it("sends only a draft that passes draftProblem, and recalls only a sent contract", async () => {
    const empty = await create("owner", form({ lines: [] }));
    const refused = await call("post", `/contracts/${empty.id}/send`, "owner");
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe("invalid_request");

    const backwards = await create("owner", form({ startsAt: "2027-03-01", endsAt: "2027-01-01" }));
    expect((await call("post", `/contracts/${backwards.id}/send`, "owner")).status).toBe(400);

    const made = await create("owner");
    const id = made.id as string;
    expect((await call("post", `/contracts/${id}/recall`, "owner")).status).toBe(400);
    const sent = await send("owner", id);
    expect(sent.status).toBe("sent");
    expect(sent.sentAt).toBeTruthy();
    expect((await call("post", `/contracts/${id}/send`, "owner")).status).toBe(400);
    const recalled = await call("post", `/contracts/${id}/recall`, "owner").expect(201);
    expect(recalled.body.status).toBe("draft");
    expect(recalled.body.sentAt).toBeNull();
  });

  it("signs with contracts.contract.approve and a name of 3 characters, leaving a signature record", async () => {
    const made = await create("owner");
    const id = made.id as string;
    expect(
      (await call("post", `/contracts/${id}/sign`, "owner").send({ signerName: "Alex Crew", signerRole: "" })).status,
    ).toBe(400);
    await send("owner", id);
    const short = await call("post", `/contracts/${id}/sign`, "manager").send({ signerName: " Al ", signerRole: "" });
    expect(short.status).toBe(400);
    expect(short.body.code).toBe("invalid_request");

    const signed = await call("post", `/contracts/${id}/sign`, "manager").send({
      signerName: "Alex Crew",
      signerRole: "Owner",
    });
    expect(signed.status, JSON.stringify(signed.body)).toBe(201);
    expect(signed.body.status).toBe("active");
    expect(signed.body.signedAt).toBeTruthy();
    expect(signed.body.signature.signerName).toBe("Alex Crew");
    expect(signed.body.signature.signerRole).toBe("Owner");
    expect(signed.body.signature.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.body.signature.events.map((e: { kind: string }) => e.kind)).toEqual(["sent", "signed"]);
    expect(
      (await call("post", `/contracts/${id}/sign`, "manager").send({ signerName: "Alex Crew", signerRole: "" })).status,
    ).toBe(400);
  });

  it("completes only active projects, closes with a problem only by an approver's override, terminates with a reason, and renews", async () => {
    const draft = await create("owner");
    expect((await call("post", `/contracts/${draft.id}/complete`, "owner")).status).toBe(400);
    expect((await call("post", `/contracts/${draft.id}/terminate`, "owner").send({ reason: "Cancelled" })).status).toBe(
      400,
    );
    expect((await call("post", `/contracts/${draft.id}/renew`, "owner")).status).toBe(400);

    const master = await activate(customerForm({ kind: "master", title: "Active master" }));
    const noComplete = await call("post", `/contracts/${master}/complete`, "owner");
    expect(noComplete.status).toBe(400);

    // Sales' own customer contract, so a user who may edit but not approve can try the override.
    const mine = await create("sales", customerForm({ title: "Sales job" }));
    const mineId = mine.id as string;
    await send("sales", mineId);
    await call("post", `/contracts/${mineId}/sign`, "owner")
      .send({ signerName: "Pat Builder", signerRole: "" })
      .expect(201);
    expect((await call("post", `/contracts/${mineId}/close`, "sales").send({ overrideReason: null })).status).toBe(400);
    const completed = await call("post", `/contracts/${mineId}/complete`, "sales").expect(201);
    expect(completed.body.status).toBe("completed");
    expect(completed.body.substantialCompletionAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const blocked = await call("post", `/contracts/${mineId}/close`, "sales").send({ overrideReason: null });
    expect(blocked.status).toBe(400);
    expect(blocked.body.message).toMatch(/final lien waiver/i);
    expect(
      (await call("post", `/contracts/${mineId}/close`, "sales").send({ overrideReason: "Owner agreed" })).status,
    ).toBe(403);
    const tooShort = await call("post", `/contracts/${mineId}/close`, "manager").send({ overrideReason: "no" });
    expect(tooShort.status).toBe(400);
    const closed = await call("post", `/contracts/${mineId}/close`, "manager").send({ overrideReason: "Owner agreed" });
    expect(closed.status, JSON.stringify(closed.body)).toBe(201);
    expect(closed.body.status).toBe("closed");
    expect(closed.body.closeOverrideReason).toBe("Owner agreed");
    expect(closed.body.finalAcceptanceAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Terminate needs a reason of 3+ and approve.
    const live = await activate();
    expect((await call("post", `/contracts/${live}/terminate`, "owner").send({ reason: "no" })).status).toBe(400);
    expect((await call("post", `/contracts/${live}/terminate`, "owner").send({ reason: "  " })).status).toBe(400);
    const ended = await call("post", `/contracts/${live}/terminate`, "owner").send({ reason: "Client cancelled" });
    expect(ended.status, JSON.stringify(ended.body)).toBe(201);
    expect(ended.body.status).toBe("terminated");
    expect(ended.body.terminationReason).toBe("Client cancelled");
    expect((await call("post", `/contracts/${live}/terminate`, "owner").send({ reason: "Again" })).status).toBe(400);

    // Renew: a new draft with a new number, linked, dates moved on, lines copied.
    const renewed = await call("post", `/contracts/${mineId}/renew`, "owner");
    expect(renewed.status, JSON.stringify(renewed.body)).toBe(201);
    expect(renewed.body.status).toBe("draft");
    expect(renewed.body.renewedFromId).toBe(mineId);
    expect(renewed.body.number).toMatch(/^CTR-\d{4}$/);
    expect(renewed.body.number).not.toBe(mine.number);
    expect(renewed.body.startsAt).toBe("2027-02-01");
    expect(renewed.body.signature).toBeNull();
    expect(renewed.body.files).toEqual([]);
    expect((await linesOf(renewed.body.id as string)).map((l) => l.code)).toEqual(["L1"]);
  });

  it("submits change orders, approves into a raised line and a new line, and rejects only with a reason", async () => {
    const id = await activate();
    const [base] = await linesOf(id);

    const draft = await create("owner");
    expect(
      (
        await call("post", `/contracts/${draft.id}/change-orders`, "owner").send({
          reason: "Too early",
          lines: [{ contractLineId: null, description: "X", category: "labor", amountDelta: "5.00" }],
        })
      ).status,
    ).toBe(400);

    const row = { contractLineId: base!.id, description: "More tile", category: "labor", amountDelta: "200.00" };
    expect(
      (await call("post", `/contracts/${id}/change-orders`, "owner").send({ reason: " ", lines: [row] })).status,
    ).toBe(400);
    expect(
      (
        await call("post", `/contracts/${id}/change-orders`, "owner").send({
          reason: "r",
          lines: [{ ...row, amountDelta: "abc" }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("post", `/contracts/${id}/change-orders`, "owner").send({
          reason: "r",
          lines: [{ ...row, description: " " }],
        })
      ).status,
    ).toBe(400);

    // A row naming another contract's line is refused.
    const [otherLine] = await linesOf(draft.id as string);
    const foreign = await call("post", `/contracts/${id}/change-orders`, "owner").send({
      reason: "Wrong line",
      lines: [{ ...row, contractLineId: otherLine!.id }],
    });
    expect(foreign.status).toBe(400);
    expect(foreign.body.message).toMatch(/not on the contract/i);

    // A manager submits; the decision below is the owner's.
    const submitted = await call("post", `/contracts/${id}/change-orders`, "manager").send({
      reason: "Extra work",
      lines: [row, { contractLineId: null, description: "Grout", category: "material", amountDelta: "50" }],
    });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    expect(submitted.body.status).toBe("pending");
    expect(submitted.body.number).toBe("CO-1");
    expect((await linesOf(id)).find((l) => l.code === "L1")!.scheduledValue).toBe("1000.00");

    const unreasoned = await call("post", `/change-orders/${submitted.body.id}/decision`, "owner").send({
      action: "reject",
      reason: "no",
    });
    expect(unreasoned.status).toBe(400);
    const approved = await call("post", `/change-orders/${submitted.body.id}/decision`, "owner").send({
      action: "approve",
      reason: "",
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(201);
    expect(approved.body.status).toBe("approved");
    const after = await linesOf(id);
    expect(after.map((l) => `${l.code}=${l.scheduledValue}`).sort()).toEqual(["CO-1.2=50.00", "L1=1200.00"]);
    const contract = (await call("get", "/contracts", "owner").expect(200)).body.find((c: Json) => c.id === id);
    expect(contract.originalValue).toBe("1000.00");
    expect(
      (
        await call("post", `/change-orders/${submitted.body.id}/decision`, "owner").send({
          action: "approve",
          reason: "",
        })
      ).status,
    ).toBe(400);

    const second = await call("post", `/contracts/${id}/change-orders`, "manager").send({
      reason: "Maybe",
      lines: [row],
    });
    expect(second.body.number).toBe("CO-2");
    const rejected = await call("post", `/change-orders/${second.body.id}/decision`, "owner").send({
      action: "reject",
      reason: "Over budget",
    });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(201);
    expect(rejected.body.status).toBe("rejected");
    expect(rejected.body.decisionReason).toBe("Over budget");
    expect((await linesOf(id)).find((l) => l.code === "L1")!.scheduledValue).toBe("1200.00");
    expect(
      (await call("post", `/change-orders/${uuidv7()}/decision`, "owner").send({ action: "approve", reason: "" }))
        .status,
    ).toBe(404);
  });

  it("records lien waivers (unconditional needs a confirmed payment) and one insurance certificate per subcontract", async () => {
    const id = await activate();
    const waiver = (over: Json = {}) => ({
      type: "conditional_final",
      paymentId: null,
      supplierPaymentId: null,
      amount: "100.00",
      throughDate: "2026-11-10",
      statutoryForm: false,
      ...over,
    });

    const noPayment = await call("post", `/contracts/${id}/lien-waivers`, "accountant").send(
      waiver({ type: "unconditional_final" }),
    );
    expect(noPayment.status).toBe(400);
    expect(noPayment.body.code).toBe("invalid_request");
    expect(
      (await call("post", `/contracts/${id}/lien-waivers`, "accountant").send(waiver({ amount: "0.00" }))).status,
    ).toBe(400);
    expect(
      (await call("post", `/contracts/${id}/lien-waivers`, "accountant").send(waiver({ supplierPaymentId: uuidv7() })))
        .status,
    ).toBe(400);

    const handle = await harness.companyDb(company.id);
    let confirmed = "";
    let pending = "";
    try {
      const base = {
        supplierId,
        date: "2026-11-05",
        method: "check" as const,
        amount: "100.00",
        recordedById: uuidv7(),
        recordedAt: new Date(),
      };
      const [a] = await handle.db
        .insert(paymentsMade)
        .values({ ...base, number: "PAY-T1", status: "confirmed" as const })
        .returning();
      const [b] = await handle.db
        .insert(paymentsMade)
        .values({ ...base, number: "PAY-T2", status: "pending" as const })
        .returning();
      confirmed = a!.id;
      pending = b!.id;
    } finally {
      await handle.close();
    }
    expect(
      (
        await call("post", `/contracts/${id}/lien-waivers`, "accountant").send(
          waiver({ type: "unconditional_final", supplierPaymentId: pending }),
        )
      ).status,
    ).toBe(400);
    const ok = await call("post", `/contracts/${id}/lien-waivers`, "accountant").send(
      waiver({ type: "unconditional_progress", supplierPaymentId: confirmed }),
    );
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.direction).toBe("received");
    expect(ok.body.status).toBe("received");
    expect(ok.body.amount).toBe("100.00");
    expect(ok.body.state).toBe("CO");
    const conditional = await call("post", `/contracts/${id}/lien-waivers`, "accountant").send(waiver());
    expect(conditional.status).toBe(201);
    expect(
      (await call("get", "/lien-waivers", "owner").expect(200)).body.filter((w: Json) => w.contractId === id),
    ).toHaveLength(2);

    const master = await create("owner", customerForm({ kind: "master", title: "No waivers here" }));
    expect((await call("post", `/contracts/${master.id}/lien-waivers`, "owner").send(waiver())).status).toBe(400);

    const coverage = (over: Json = {}) => ({
      type: "general",
      insurer: "Mutual",
      policyNumber: "GL-1",
      effectiveOn: "2026-01-01",
      expiresOn: "2027-01-01",
      limits: "1M",
      ...over,
    });
    const cert = (coverages: Json[], producer = "Agency") => ({
      producer,
      holder: "Us",
      additionalInsured: true,
      coverages,
    });
    expect((await call("put", `/contracts/${id}/insurance-certificate`, "accountant").send(cert([]))).status).toBe(400);
    expect(
      (
        await call("put", `/contracts/${id}/insurance-certificate`, "accountant").send(
          cert([coverage({ expiresOn: "2025-12-31" })]),
        )
      ).status,
    ).toBe(400);
    expect((await call("put", `/contracts/${id}/insurance-certificate`, "sales").send(cert([coverage()]))).status).toBe(
      403,
    );

    const customerContract = await create("owner", customerForm({ title: "Customer, no cert" }));
    const onCustomer = await call("put", `/contracts/${customerContract.id}/insurance-certificate`, "accountant").send(
      cert([coverage()]),
    );
    expect(onCustomer.status).toBe(400);
    expect(onCustomer.body.message).toMatch(/subcontract/i);

    const saved = await call("put", `/contracts/${id}/insurance-certificate`, "accountant").send(cert([coverage()]));
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const replaced = await call("put", `/contracts/${id}/insurance-certificate`, "accountant").send(
      cert([coverage({ type: "auto", policyNumber: "A-1" })], "Agency 2"),
    );
    expect(replaced.body.id).toBe(saved.body.id);
    expect(replaced.body.producer).toBe("Agency 2");
    expect(replaced.body.coverages).toHaveLength(1);
    expect(replaced.body.coverages[0].type).toBe("auto");
    expect(
      (await call("get", "/insurance-certificates", "owner").expect(200)).body.filter((c: Json) => c.contractId === id),
    ).toHaveLength(1);
  });

  it("limits an own-scope Sales user to their contracts, and a branch manager to their branch", async () => {
    const ownerA = await create("owner", form({ title: "Owner branch A", branchId: branchA }));
    const ownerB = await create("owner", form({ title: "Owner branch B", branchId: branchB }));
    const salesOwn = await create("sales", customerForm({ title: "Sales own" }));

    const salesList = (await call("get", "/contracts", "sales").expect(200)).body as Json[];
    expect(salesList.map((c) => c.id)).toContain(salesOwn.id);
    expect(salesList.every((c) => c.salesRepId === salesOwn.salesRepId)).toBe(true);
    expect(salesList.map((c) => c.id)).not.toContain(ownerA.id);
    expect(salesOwn.salesRepId).toBeTruthy();
    expect(salesOwn.branchId).toBe(branchA);
    expect((await linesOf(ownerA.id as string, "sales")).length).toBe(0);
    const salesChangeOrders = (await call("get", "/change-orders", "sales").expect(200)).body as Json[];
    expect(salesChangeOrders).toEqual([]);
    expect((await call("put", `/contracts/${ownerA.id}`, "sales").send(form())).status).toBe(404);
    expect((await call("post", `/contracts/${ownerA.id}/send`, "sales")).status).toBe(404);
    expect((await call("post", `/contracts/${ownerA.id}/files`, "sales").send({ files: [PDF] })).status).toBe(404);

    const managerIds = ((await call("get", "/contracts", "manager").expect(200)).body as Json[]).map((c) => c.id);
    expect(managerIds).toContain(ownerA.id);
    expect(managerIds).toContain(salesOwn.id);
    expect(managerIds).not.toContain(ownerB.id);
    expect((await linesOf(ownerB.id as string, "manager")).length).toBe(0);
    expect((await call("put", `/contracts/${ownerB.id}`, "manager").send(form())).status).toBe(404);
    expect((await call("post", `/contracts/${ownerB.id}/send`, "manager")).status).toBe(404);

    const ownerIds = ((await call("get", "/contracts", "owner").expect(200)).body as Json[]).map((c) => c.id);
    expect(ownerIds).toEqual(expect.arrayContaining([ownerA.id, ownerB.id, salesOwn.id]));

    // Another company's data is unreachable.
    expect((await call("get", "/contracts", "otherManager").expect(200)).body).toEqual([]);
    expect((await call("get", "/contract-lines", "otherManager").expect(200)).body).toEqual([]);
    expect((await call("post", `/contracts/${ownerA.id}/send`, "otherManager")).status).toBe(404);
    // The form's party and warehouse are company A's rows, so B's validation refuses before any lock.
    expect([400, 404]).toContain((await call("put", `/contracts/${ownerA.id}`, "otherManager").send(form())).status);
  });

  it("strips estimatedCost without view_sensitive and keeps the stored cost on its saves", async () => {
    const made = await create(
      "sales",
      customerForm({ title: "Cost test", lines: [line({ estimatedCost: "999.00" })] }),
    );
    const id = made.id as string;
    // Sales can't enter a cost: the request value is ignored.
    expect((await linesOf(id, "owner"))[0]!.estimatedCost).toBe("0.00");

    const priced = await call("put", `/contracts/${id}`, "owner").send(customerForm({ title: "Cost test" }));
    expect(priced.status, JSON.stringify(priced.body)).toBe(200);
    expect((await linesOf(id, "owner"))[0]!.estimatedCost).toBe("600.00");

    const salesLines = await linesOf(id, "sales");
    expect(salesLines).toHaveLength(1);
    expect(salesLines[0]).not.toHaveProperty("estimatedCost");
    for (const who of ["manager", "accountant"] as const) {
      expect((await linesOf(id, who))[0]!.estimatedCost).toBe("600.00");
    }

    // A save by sales, with or without a cost, keeps 600.00.
    const withoutCost = line();
    delete (withoutCost as Partial<typeof withoutCost>).estimatedCost;
    const saved = await call("put", `/contracts/${id}`, "sales").send(
      customerForm({ title: "Cost test 2", lines: [withoutCost] }),
    );
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect((await linesOf(id, "owner"))[0]!.estimatedCost).toBe("600.00");
    await call("put", `/contracts/${id}`, "sales")
      .send(customerForm({ lines: [line({ estimatedCost: "1.00" })] }))
      .expect(200);
    // Renaming the costed line, or two lines with one code, can't drop or move its cost (PR #23 review).
    const code = (await linesOf(id, "owner"))[0]!.code as string;
    const renamed = await call("put", `/contracts/${id}`, "sales").send(
      customerForm({ lines: [line({ code: `${code}-X` })] }),
    );
    expect(renamed.status).toBe(400);
    const twice = await call("put", `/contracts/${id}`, "owner").send(
      customerForm({ lines: [line({ scheduledValue: "500.00" }), line({ scheduledValue: "500.00" })] }),
    );
    expect(twice.status).toBe(400);
    expect((await linesOf(id, "owner"))[0]!.estimatedCost).toBe("600.00");
    // Turning the draft into a master and back would drop every cost, so the switch is refused too.
    const toMaster = await call("put", `/contracts/${id}`, "sales").send(customerForm({ kind: "master", lines: [] }));
    expect(toMaster.status).toBe(400);
    expect(toMaster.body.message).not.toContain("cost estimate");
    expect((await linesOf(id, "owner"))[0]!.estimatedCost).toBe("600.00");
    // Someone who sees costs may make it a master; its lines go.
    await call("put", `/contracts/${id}`, "owner")
      .send(customerForm({ kind: "master", lines: [] }))
      .expect(200);
    expect(await linesOf(id, "owner")).toEqual([]);
  });

  it("adds files and serves them through GET /files/:id only within the contract's scope", async () => {
    const inA = await create("owner", form({ title: "Files A", branchId: branchA }));
    const inB = await create("owner", form({ title: "Files B", branchId: branchB }));
    const addedA = await call("post", `/contracts/${inA.id}/files`, "manager").send({ files: [PDF] });
    expect(addedA.status, JSON.stringify(addedA.body)).toBe(201);
    expect(addedA.body.files).toHaveLength(1);
    const addedB = await call("post", `/contracts/${inB.id}/files`, "owner").send({ files: [PDF] });
    expect(addedB.status, JSON.stringify(addedB.body)).toBe(201);
    expect((await call("post", `/contracts/${inA.id}/files`, "owner").send({ files: [] })).status).toBe(400);

    const fileA = addedA.body.files[0].id as string;
    const fileB = addedB.body.files[0].id as string;
    expect((await call("get", `/files/${fileA}`, "owner")).status).toBe(200);
    expect((await call("get", `/files/${fileA}`, "manager")).status).toBe(200);
    expect((await call("get", `/files/${fileA}`, "accountant")).status).toBe(200);
    expect((await call("get", `/files/${fileA}`, "sales")).status).toBe(404);
    expect((await call("get", `/files/${fileB}`, "owner")).status).toBe(200);
    expect((await call("get", `/files/${fileB}`, "manager")).status).toBe(404);
    expect((await call("get", `/files/${fileA}`, "warehouse")).status).toBe(403);
    expect((await call("get", `/files/${fileA}`, "otherManager")).status).toBe(404);
  });

  it("writes audit_log for each contract write", async () => {
    const id = await activate(form({ title: "Audited" }));
    const [base] = await linesOf(id);
    await call("put", `/contracts/${uuidv7()}`, "owner").send(form()).expect(404);
    const co = await call("post", `/contracts/${id}/change-orders`, "owner").send({
      reason: "Audit",
      lines: [{ contractLineId: base!.id, description: "More", category: "labor", amountDelta: "10.00" }],
    });
    await call("post", `/change-orders/${co.body.id}/decision`, "owner")
      .send({ action: "approve", reason: "" })
      .expect(201);
    await call("post", `/contracts/${id}/lien-waivers`, "owner")
      .send({
        type: "conditional_progress",
        paymentId: null,
        supplierPaymentId: null,
        amount: "10.00",
        throughDate: "2026-11-10",
        statutoryForm: false,
      })
      .expect(201);
    await call("put", `/contracts/${id}/insurance-certificate`, "owner")
      .send({
        producer: "Agency",
        holder: "Us",
        additionalInsured: false,
        coverages: [
          {
            type: "general",
            insurer: "Mutual",
            policyNumber: "G",
            effectiveOn: "2026-01-01",
            expiresOn: "2027-01-01",
            limits: "",
          },
        ],
      })
      .expect(200);
    await call("post", `/contracts/${id}/files`, "owner")
      .send({ files: [PDF] })
      .expect(201);
    await call("post", `/contracts/${id}/complete`, "owner").expect(201);
    await call("post", `/contracts/${id}/terminate`, "owner").send({ reason: "Audit end" }).expect(201);
    await call("post", `/contracts/${id}/renew`, "owner").expect(201);

    const actions = await auditActions(id);
    for (const expected of [
      "Added contract",
      "Sent contract for signature",
      "Recorded simulated signature",
      "Submitted change order",
      "Approved change order",
      "Recorded lien waiver",
      "Saved insurance certificate",
      "Added contract files",
      "Completed contract",
      "Terminated contract",
    ]) {
      expect(actions, expected).toContain(expected);
    }

    const edited = await create("owner");
    await call("put", `/contracts/${edited.id}`, "owner")
      .send(form({ title: "Edited" }))
      .expect(200);
    await send("owner", edited.id as string);
    await call("post", `/contracts/${edited.id}/recall`, "owner").expect(201);
    expect(await auditActions(edited.id as string)).toEqual(
      expect.arrayContaining(["Added contract", "Edited contract", "Sent contract for signature", "Recalled contract"]),
    );

    // A refused write leaves no audit row behind.
    const before = (await auditActions(edited.id as string)).length;
    await call("post", `/contracts/${edited.id}/sign`, "owner")
      .send({ signerName: "Alex Crew", signerRole: "" })
      .expect(400);
    expect((await auditActions(edited.id as string)).length).toBe(before);

    // Renew audits as an added contract on the new record.
    const renewedFrom = (await call("get", "/contracts", "owner").expect(200)).body.find(
      (c: Json) => c.renewedFromId === id,
    );
    expect(await auditActions(renewedFrom.id)).toContain("Added contract");
  });

  it("adds every row on one line when a change order is approved, and refuses a new line below zero", async () => {
    const id = await activate();
    const [base] = await linesOf(id);
    const before = base!.scheduledValue as string;
    const twice = { contractLineId: base!.id, description: "More tile", category: "labor", amountDelta: "100.00" };
    const order = await call("post", `/contracts/${id}/change-orders`, "owner")
      .send({ reason: "Two rows on one line", lines: [twice, twice] })
      .expect(201);
    await call("post", `/change-orders/${order.body.id}/decision`, "owner")
      .send({ action: "approve", reason: "" })
      .expect(201);
    const [after] = (await linesOf(id)).filter((candidate) => candidate.id === base!.id);
    expect(after!.scheduledValue).toBe(moneyString(dec(before).plus(200)));

    // A new line below zero is refused when it is submitted, not only at approval.
    const refused = await call("post", `/contracts/${id}/change-orders`, "owner").send({
      reason: "A credit as a new line",
      lines: [{ contractLineId: null, description: "Credit", category: "labor", amountDelta: "-50.00" }],
    });
    expect(refused.status).toBe(400);
    expect(refused.body.message).toContain("above zero");
  });

  it("gives a change order's new line a code no live line uses", async () => {
    const id = await activate(customerForm({ lines: [line({ code: "CO-1.1" })] }));
    const order = await call("post", `/contracts/${id}/change-orders`, "owner")
      .send({
        reason: "Extra room",
        lines: [{ contractLineId: null, description: "Hall", category: "labor", amountDelta: "75.00" }],
      })
      .expect(201);
    await call("post", `/change-orders/${order.body.id}/decision`, "owner")
      .send({ action: "approve", reason: "" })
      .expect(201);
    const codes = (await linesOf(id)).map((entry) => entry.code as string);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain("CO-1.1-2");
  });
});
