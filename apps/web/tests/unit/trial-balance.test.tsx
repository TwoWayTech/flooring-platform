import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TRIAL_BALANCE_HIDDEN, type TrialBalance, type TrialBalanceRow } from "@workspace/shared";
import { ReportFallback } from "@/features/reports/report-fallback";
import {
  balanceSide,
  isEmptyAccount,
  outOfBalanceBy,
  trialBalanceCsv,
  trialBalanceGroups,
} from "@/features/reports/trial-balance-model";
import type { ApiClient } from "@/lib/api/contract";
import type { FileStore } from "@/lib/api/demo/file-store";
import { DemoStore } from "@/lib/api/demo/store";
import { API_METHODS } from "@/lib/api/http/api-methods";
import { routeClient } from "@/lib/api/http/router";
import { HttpApiError, HttpTransport } from "@/lib/api/http/transport";
import type { QueryState } from "@/lib/api/use-api";

function row(
  code: string,
  name: string,
  type: TrialBalanceRow["type"],
  debit: string,
  credit: string,
  balance: string,
) {
  return { key: null, code, name, type, debit, credit, balance } satisfies TrialBalanceRow;
}

const BOOKS: TrialBalance = {
  through: "2026-10-31",
  rows: [
    row("1000", "Cash and Bank", "asset", "250.00", "40.00", "210.00"),
    row("1100", "Accounts Receivable", "asset", "300.00", "250.00", "50.00"),
    row("2000", "Accounts Payable", "liability", "0.00", "0.00", "0.00"),
    row("4000", "Sales, retail", "revenue", "0.00", "300.00", "-300.00"),
    row("5000", "Cost of Goods Sold", "expense", "40.00", "0.00", "40.00"),
  ],
  debit: "590.00",
  credit: "590.00",
  balanced: true,
};

/** The real API_METHODS over a fake fetch that records each request and answers with `body`. */
function apiClient(answer: { status: number; body: unknown }) {
  const sent: string[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    sent.push(`${init?.method ?? "GET"} ${url.replace("http://api.test", "")}`);
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  }) as unknown as typeof fetch;
  const demo = { subscribe: () => () => undefined } as unknown as ApiClient;
  return { client: routeClient(demo, new HttpTransport("http://api.test", fetcher), API_METHODS), sent };
}

const noFiles: FileStore = {
  put: async () => undefined,
  get: async () => undefined,
  remove: async () => undefined,
  clear: async () => undefined,
};

describe("the trial balance screen's model (ADR 0055 Trial balance)", () => {
  it("groups accounts by kind in chart order and hides empty accounts unless asked", () => {
    expect(trialBalanceGroups(BOOKS, false).map((g) => [g.label, g.rows.map((r) => r.code)])).toEqual([
      ["Assets", ["1000", "1100"]],
      ["Revenue", ["4000"]],
      ["Expenses", ["5000"]],
    ]);
    expect(trialBalanceGroups(BOOKS, true).map((g) => g.label)).toEqual([
      "Assets",
      "Liabilities",
      "Revenue",
      "Expenses",
    ]);
    expect(isEmptyAccount(BOOKS.rows[2]!)).toBe(true);
    expect(isEmptyAccount(row("6000", "Wages", "expense", "5.00", "5.00", "0.00"))).toBe(false);
  });

  it("prints a balance as a positive amount on its side", () => {
    expect(balanceSide("210.00")).toEqual({ side: "Dr", amount: "210.00" });
    expect(balanceSide("-300.00")).toEqual({ side: "Cr", amount: "300.00" });
    expect(balanceSide("0.00")).toEqual({ side: null, amount: "0.00" });
  });

  it("says how far apart unbalanced books are, exactly", () => {
    expect(outOfBalanceBy(BOOKS)).toBe("0.00");
    expect(outOfBalanceBy({ ...BOOKS, debit: "100.10", credit: "100.30", balanced: false })).toBe("0.20");
  });

  it("exports the rows on screen and the totals with raw values", () => {
    expect(trialBalanceCsv(BOOKS, false).split("\n")).toEqual([
      "Code,Account,Type,Debits,Credits,Balance",
      "1000,Cash and Bank,Assets,250.00,40.00,210.00",
      "1100,Accounts Receivable,Assets,300.00,250.00,50.00",
      '4000,"Sales, retail",Revenue,0.00,300.00,-300.00',
      "5000,Cost of Goods Sold,Expenses,40.00,0.00,40.00",
      ",Total,,590.00,590.00,0.00",
    ]);
    expect(trialBalanceCsv(BOOKS, true)).toContain("2000,Accounts Payable,Liabilities,0.00,0.00,0.00");
  });
});

describe("the trial balance on the API and in the demo", () => {
  it("reads GET /ledger/trial-balance through a day, or all time", async () => {
    const { client, sent } = apiClient({ status: 200, body: BOOKS });
    expect(await client.trialBalance("2026-10-31")).toEqual(BOOKS);
    await client.trialBalance(null);
    expect(sent).toEqual(["GET /ledger/trial-balance?through=2026-10-31", "GET /ledger/trial-balance"]);
  });

  it("rejects the sight refusal with the server's words, and shows it with Show my reports", async () => {
    const { client } = apiClient({ status: 403, body: { code: "forbidden", message: TRIAL_BALANCE_HIDDEN } });
    const failure = await client.trialBalance(null).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(HttpApiError);
    const query: QueryState<unknown> = {
      status: "error",
      data: undefined,
      error: failure as Error,
      retry: () => undefined,
    };
    const html = renderToStaticMarkup(<ReportFallback query={query} label="Loading" onRefresh={() => undefined} />);
    expect(html).toContain(TRIAL_BALANCE_HIDDEN.replace("'", "&#x27;"));
    expect(html).toContain("Show my reports");
    expect(html).not.toContain("Try again");
  });

  it("is never offered in the demo, which keeps no journal, and refuses if asked", async () => {
    for (const userId of ["sm-usr-01", "sm-usr-06"]) {
      const store = new DemoStore(noFiles);
      await store.openCompany("summit", { userId, viewAsRoleId: null });
      const options = await store.reportOptions();
      expect(options.reports).not.toContain("trial-balance");
      expect(options.exports).not.toContain("trial-balance");
      await expect(store.trialBalance(null)).rejects.toThrow("The demo keeps no journal");
    }
  });
});
