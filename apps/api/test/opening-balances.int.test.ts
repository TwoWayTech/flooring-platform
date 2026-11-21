import { totpCode, totpSecretFromUri } from "@workspace/db/testing";
import { loadDemoCompany } from "@workspace/db/seed";
import {
  dec,
  ledgerIndex,
  moneyString,
  sum,
  type Invoice,
  type InvoiceAdjustment,
  type Payment,
  type TrialBalance,
} from "@workspace/shared";
import request from "supertest";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dayIn } from "../src/modules/sales/sales-common";
import { AuthHarness, PASSWORD, SUMMIT_ID, sessionCookie } from "./auth-harness";
import { balanceOf, trialBalanceProblems } from "./support/ledger-read";

/** A small file that starts like a PDF, as proof of payment. */
const PDF = { name: "receipt.pdf", data: Buffer.from("%PDF-1.4\n% proof of payment\n").toString("base64") };

/** Summit's own day: the API dates a payment by the company's time zone. */
const SUMMIT_ZONE = loadDemoCompany("summit").fixtures.settings.localization.region.timeZone;

/**
 * The seed's opening balances on the API (ADR 0062; click-through #13): Summit's trial balance
 * balances from the first sign-in with receivables equal to its open invoices, and recording a
 * payment on a seeded invoice moves receivables down by what it settles, never below zero and
 * always equal to what the invoices still owe.
 */
describe("opening balances: settling a seeded invoice keeps the books right (needs the local PostgreSQL)", () => {
  const harness = new AuthHarness();
  const cookies = { owner: "", accountant: "" };

  function call(method: "get" | "post", path: string, cookie: string) {
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

  async function trialBalance(): Promise<TrialBalance> {
    return (await call("get", "/ledger/trial-balance", cookies.owner).expect(200)).body as TrialBalance;
  }

  /** Each invoice's balance as the screens work it out from the API's documents (`invoiceLedger`). */
  async function openBalances(): Promise<Map<string, string>> {
    const invoices = (await call("get", "/invoices", cookies.owner).expect(200)).body as Invoice[];
    const payments = (await call("get", "/payments", cookies.owner).expect(200)).body as Payment[];
    const adjustments = (await call("get", "/invoice-adjustments", cookies.owner).expect(200))
      .body as InvoiceAdjustment[];
    const ledgers = ledgerIndex(invoices, { payments, adjustments }, dayIn(new Date(), SUMMIT_ZONE));
    return new Map([...ledgers.entries()].map(([id, ledger]) => [id, ledger.balance]));
  }

  beforeAll(async () => {
    await harness.start();
    cookies.owner = await enrolled(await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["owner"] }));
    cookies.accountant = await enrolled(await harness.addUser({ companyIds: [SUMMIT_ID], roles: ["accountant"] }));
  }, 600_000);

  afterAll(async () => {
    await harness.stop();
  });

  it("balances from the first sign-in, with receivables equal to the open invoices", async () => {
    const trial = await trialBalance();
    expect(trialBalanceProblems(trial)).toEqual([]);
    const open = sum([...(await openBalances()).values()]);
    expect(open.gt(0)).toBe(true);
    expect(moneyString(balanceOf(trial, "accounts_receivable"))).toBe(moneyString(open));
    expect(balanceOf(trial, "opening_balance_equity").isZero()).toBe(false);
  });

  it("moves receivables down by a seeded invoice's balance when it is paid, never below zero", async () => {
    const before = await trialBalance();
    const balances = await openBalances();
    const [invoiceId, owed] = [...balances.entries()].find(([, balance]) => dec(balance).gt(0))!;
    const recorded = await call("post", "/payments", cookies.owner)
      .send({
        invoiceId,
        kind: "payment",
        amount: owed,
        date: dayIn(new Date(), SUMMIT_ZONE),
        method: "check",
        checkNumber: "5150",
        cardLast4: "",
        reference: `CHK-${uuidv7()}`,
        note: "",
        extraAsCredit: false,
        allowDuplicateReference: false,
        files: [PDF],
      })
      .expect(201);
    if (recorded.body.status === "pending") {
      await call("post", `/payments/${recorded.body.id}/review`, cookies.accountant)
        .send({ action: "confirm" })
        .expect(201);
    }
    const after = await trialBalance();
    expect(trialBalanceProblems(after)).toEqual([]);
    const receivable = balanceOf(after, "accounts_receivable");
    expect(receivable.gte(0)).toBe(true);
    expect(moneyString(balanceOf(before, "accounts_receivable").minus(receivable))).toBe(moneyString(owed));
    expect(moneyString(balanceOf(after, "cash").minus(balanceOf(before, "cash")))).toBe(moneyString(owed));
    const remaining = await openBalances();
    expect(remaining.get(invoiceId)).toBe("0.00");
    expect(moneyString(receivable)).toBe(moneyString(sum([...remaining.values()])));
    expect(balanceOf(after, "cash").gt(0)).toBe(true);
  });
});
