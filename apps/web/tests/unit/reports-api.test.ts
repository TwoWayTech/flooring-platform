import { describe, expect, it } from "vitest";
import { EMPTY_REPORT_OPTIONS, REPORT_WHOLE_COMPANY, type Report, type ReportOptions } from "@workspace/shared";
import type { ApiClient } from "@/lib/api/contract";
import { API_METHODS } from "@/lib/api/http/api-methods";
import { routeClient } from "@/lib/api/http/router";
import { HttpApiError, HttpTransport } from "@/lib/api/http/transport";

type Answer = { status: number; body?: unknown } | "network";

/**
 * The real API_METHODS over a fake fetch that records each request ("METHOD path?query") and answers
 * per path without the query (200 with an empty object by default). The demo client is a stub, so a
 * report method that fell through to it would throw.
 */
function apiClient(answers: Record<string, Answer> = {}) {
  const sent: string[] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    const call = `${init?.method ?? "GET"} ${url.replace("http://api.test", "")}`;
    sent.push(call);
    const answer = answers[call.split("?")[0]!] ?? { status: 200, body: {} };
    if (answer === "network") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(answer.body ?? {}), { status: answer.status });
  }) as unknown as typeof fetch;
  const demo = { subscribe: () => () => undefined } as unknown as ApiClient;
  return { client: routeClient(demo, new HttpTransport("http://api.test", fetcher), API_METHODS), sent };
}

/** The error a call rejects with, or null when it resolved. */
async function failureOf(call: Promise<unknown>): Promise<HttpApiError | null> {
  try {
    await call;
    return null;
  } catch (failure) {
    if (failure instanceof HttpApiError) return failure;
    throw failure;
  }
}

const OPTIONS: ReportOptions = {
  reports: ["sales", "payments"],
  exports: ["sales"],
  locations: [{ id: "0195f3a2-7b1c-7d4e-8f00-00000000dd01", name: "Denver Central", kind: "warehouse" }],
  salespeople: [],
  vendors: [],
};
const REPORT: Report = {
  title: "Sales by category",
  columns: [{ id: "category", header: "Category" }],
  rows: [],
  totals: { category: "Total" },
};

describe("reports on the API (ADR 0055)", () => {
  it("W-API-1 sends each report method to its route and gives back the answer", async () => {
    const { client, sent } = apiClient({
      "GET /reports/options": { status: 200, body: OPTIONS },
      "GET /reports/sales-by-category": { status: 200, body: REPORT },
    });
    expect(await client.reportOptions()).toEqual(OPTIONS);
    await client.businessReport({
      from: "2026-10-01",
      to: "2026-10-31",
      locationIds: [],
      productCategory: null,
      expenseCategory: null,
      salesRepId: null,
      supplierId: null,
    });
    await client.pnlReport({ range: "12m", locationId: null });
    expect(await client.salesByCategoryReport({ range: "3m", locationId: null, category: null })).toEqual(REPORT);
    await client.paymentsReport({ range: "1m", locationId: null, method: "check", customer: "" });
    expect(sent).toEqual([
      "GET /reports/options",
      "GET /reports/business?from=2026-10-01&to=2026-10-31",
      "GET /reports/pnl?range=12m",
      "GET /reports/sales-by-category?range=3m",
      "GET /reports/payments?range=1m&method=check",
    ]);
  });

  it("W-API-1 reads options refused for want of a report key (403 forbidden) or with the hub off (404) as no reports", async () => {
    const forbidden = apiClient({
      "GET /reports/options": {
        status: 403,
        body: {
          code: "forbidden",
          message: "Your role does not allow this. Ask an Owner to change your security role.",
        },
      },
    });
    expect(await forbidden.client.reportOptions()).toEqual(EMPTY_REPORT_OPTIONS);
    const off = apiClient({
      "GET /reports/options": { status: 404, body: { code: "not_found", message: "Not found." } },
    });
    expect(await off.client.reportOptions()).toEqual(EMPTY_REPORT_OPTIONS);
  });

  it("W-API-1 lets every other options failure surface: MFA, a suspended company, the wrong product, no session, no network", async () => {
    const cases: [Answer, number, string][] = [
      [
        { status: 403, body: { code: "mfa_enrolment_required", message: "Set up two-step sign-in." } },
        403,
        "mfa_enrolment_required",
      ],
      [
        { status: 403, body: { code: "company_suspended", message: "This company is suspended." } },
        403,
        "company_suspended",
      ],
      [
        { status: 403, body: { code: "product_not_enabled", message: "Not in this product." } },
        403,
        "product_not_enabled",
      ],
      [{ status: 401, body: { code: "unauthenticated", message: "Sign in again." } }, 401, "unauthenticated"],
      ["network", 0, "network"],
    ];
    for (const [answer, status, code] of cases) {
      const { client } = apiClient({ "GET /reports/options": answer });
      const failure = await failureOf(client.reportOptions());
      expect(failure, code).not.toBeNull();
      expect({ status: failure?.status, code: failure?.code }).toEqual({ status, code });
    }
  });

  it("W-API-1 rejects a refused report with the server's words, for the screen to show", async () => {
    const { client } = apiClient({
      "GET /reports/business": { status: 403, body: { code: "forbidden", message: REPORT_WHOLE_COMPANY } },
      "GET /reports/pnl": { status: 404, body: { code: "not_found", message: "Not found." } },
    });
    const business = await failureOf(
      client.businessReport({
        from: "2026-10-01",
        to: "2026-10-31",
        locationIds: [],
        productCategory: null,
        expenseCategory: null,
        salesRepId: null,
        supplierId: null,
      }),
    );
    expect({ status: business?.status, code: business?.code, message: business?.message }).toEqual({
      status: 403,
      code: "forbidden",
      message: REPORT_WHOLE_COMPANY,
    });
    expect((await failureOf(client.pnlReport({ range: "12m", locationId: null })))?.status).toBe(404);
  });
});
