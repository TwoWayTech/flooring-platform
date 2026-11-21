import { randomBytes } from "node:crypto";
import { NoopProvisioner } from "@workspace/providers";
import { dec, moneyString, type Dec } from "@workspace/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openCompanyDb, type CompanyDb } from "../src";
import { OPENING_MEMO, openingEntryId, seedOpening, seedTestCompany } from "../src/seed";
import { loadDemoCompany } from "../src/seed/fixtures";
import { scratchDatabase } from "../src/testing";

const encryptionKey = randomBytes(32).toString("base64");

/** One figure read with SQL, as a decimal. */
async function figure(db: CompanyDb, query: ReturnType<typeof sql>): Promise<Dec> {
  const [row] = await db.execute<{ value: string | null }>(query);
  return dec(row?.value ?? "0");
}

/** Each default account's balance, debits less credits, by its key, over the whole journal. */
async function balances(db: CompanyDb): Promise<Map<string, Dec>> {
  const rows = await db.execute<{ key: string; balance: string }>(sql`
    select a.key, coalesce(sum(l.debit - l.credit), 0)::text as balance
    from ledger_accounts a left join journal_lines l on l.account_id = a.id
    group by a.key`);
  return new Map([...rows].map((row) => [row.key, dec(row.balance)]));
}

/**
 * The seed's opening balances (ADR 0062; click-through #13), read back from a seeded Summit with
 * SQL written apart from the seed's own figures: the books balance, and receivables, payables,
 * stock and retainage each match what the documents in the database say.
 */
describe("the seed opens Summit's books with one opening-balance entry", () => {
  const scratch: { url: string; drop: () => Promise<void> }[] = [];
  let company: ReturnType<typeof openCompanyDb>;
  let books = new Map<string, Dec>();

  beforeAll(async () => {
    scratch.push(await scratchDatabase("obal_control"), await scratchDatabase("obal_company"));
    const options = {
      controlUrl: scratch[0].url,
      encryptionKey,
      provisioner: new NoopProvisioner(scratch[1].url),
      provider: "noop",
    };
    await seedTestCompany(options);
    await seedTestCompany(options);
    company = openCompanyDb(scratch[1].url, { max: 1 });
    books = await balances(company.db);
  }, 600_000);

  afterAll(async () => {
    await company?.close();
    for (const database of scratch) await database.drop();
  });

  it("posts one entry, once, against Opening Balance Equity, dated before every open document", async () => {
    const entries = await company.db.execute<{ id: string; date: string; memo: string; source_type: string }>(
      sql`select id, date::text, memo, source_type from journal_entries`,
    );
    expect([...entries]).toEqual([
      {
        id: openingEntryId("summit"),
        date: seedOpening(loadDemoCompany("summit").fixtures)!.date,
        memo: OPENING_MEMO,
        source_type: "opening_balance",
      },
    ]);
    const [equity] = await company.db.execute<{ code: string; name: string; type: string }>(
      sql`select code, name, type from ledger_accounts where key = 'opening_balance_equity'`,
    );
    expect(equity).toEqual({ code: "3900", name: "Opening Balance Equity", type: "equity" });
    expect(books.get("opening_balance_equity")!.lt(0)).toBe(true);
    const earliestOpen = await company.db.execute<{ day: string }>(sql`
      select min(i.issued_at at time zone 'UTC')::date::text as day from invoices i
      where i.voided_at is null and not i.is_return and i.total > coalesce(
        (select sum(p.amount) from payments_received p where p.invoice_id = i.id and p.status = 'confirmed'), 0)`);
    expect(entries[0].date < earliestOpen[0].day).toBe(true);
  });

  it("balances, and every line is on one side", async () => {
    const [sums] = await company.db.execute<{ debit: string; credit: string; bad: string }>(sql`
      select sum(debit)::text as debit, sum(credit)::text as credit,
        count(*) filter (where (debit > 0) = (credit > 0))::text as bad from journal_lines`);
    expect(dec(sums.debit).eq(sums.credit)).toBe(true);
    expect(dec(sums.debit).gt(0)).toBe(true);
    expect(sums.bad).toBe("0");
  });

  it("opens Accounts Receivable at the sum of open invoice balances", async () => {
    // total less confirmed payments, credits and write-offs, never below zero; void invoices and
    // credit notes owe nothing (sales.md Appendix A).
    const open = await figure(
      company.db,
      sql`select sum(greatest(i.total
        - coalesce((select sum(p.amount) from payments_received p where p.invoice_id = i.id and p.status = 'confirmed'), 0)
        - coalesce((select sum(a.amount) from invoice_adjustments a where a.invoice_id = i.id), 0), 0))::text as value
      from invoices i where i.voided_at is null and not i.is_return`,
    );
    expect(open.gt(0)).toBe(true);
    expect(moneyString(books.get("accounts_receivable")!)).toBe(moneyString(open));
  });

  it("opens Accounts Payable at the sum of open bill balances", async () => {
    const open = await figure(
      company.db,
      sql`select sum(greatest(b.total - coalesce((select sum(a.amount) from payment_allocations a
        join payments_made m on m.id = a.payment_id where a.bill_id = b.id and m.status = 'confirmed'), 0), 0))::text as value
      from supplier_bills b where b.deleted_at is null`,
    );
    expect(moneyString(books.get("accounts_payable")!.negated())).toBe(moneyString(open));
  });

  it("opens Inventory at the stock value: rolls at their cost, boxed goods at average cost", async () => {
    const rolls = await figure(
      company.db,
      sql`select sum(width_ft * remaining_length_ft * cost_per_sq_ft)::text as value
      from rolls where remaining_length_ft > 0 and deleted_at is null`,
    );
    const boxed = await figure(
      company.db,
      sql`select sum(q.quantity * p.cost)::text as value from
        (select product_id, sum(quantity) as quantity from stock_movements group by product_id) q
        join products p on p.id = q.product_id`,
    );
    expect(rolls.plus(boxed).gt(0)).toBe(true);
    expect(moneyString(books.get("inventory")!)).toBe(moneyString(rolls.plus(boxed)));
    // Stock is opened per warehouse, as receipts and stock issues post it.
    const [lines] = await company.db.execute<{ n: string }>(sql`
      select count(*)::text as n from journal_lines l join ledger_accounts a on a.id = l.account_id
      where a.key = 'inventory' and l.location_id is null`);
    expect(lines.n).toBe("0");
  });

  it("opens retainage at what contract billings withheld and did not release", async () => {
    const receivable = await figure(
      company.db,
      sql`select sum(coalesce(retainage_withheld, 0) - coalesce(retainage_released, 0))::text as value
      from invoices where contract_id is not null and voided_at is null`,
    );
    const payable = await figure(
      company.db,
      sql`select sum(coalesce(retainage_withheld, 0) - coalesce(retainage_released, 0))::text as value
      from supplier_bills where contract_id is not null and deleted_at is null`,
    );
    expect(moneyString(books.get("retainage_receivable")!)).toBe(moneyString(receivable));
    expect(moneyString(books.get("retainage_payable")!.negated())).toBe(moneyString(payable));
  });

  it("starts Cash high enough to pay every seeded bill and unbilled receipt", async () => {
    const cash = books.get("cash")!;
    const owed = books
      .get("accounts_payable")!
      .plus(books.get("received_not_billed") ?? 0)
      .plus(books.get("retainage_payable") ?? 0)
      .negated();
    expect(cash.gte(owed)).toBe(true);
    expect(cash.mod(10000).isZero()).toBe(true);
  });
});
