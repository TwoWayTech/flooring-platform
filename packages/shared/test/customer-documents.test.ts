import { describe, expect, it } from "vitest";
import {
  currencyDecimals,
  defaultNumberSettings,
  EXAMPLE_TAX_RULES,
  endSentence,
  formatDocumentNumber,
  formatNumber,
  invoiceFromQuote,
  invoiceTermsText,
  type Customer,
  type LocalizationSettings,
  type NumberSettings,
  type PaymentTerms,
  type Quote,
} from "../src";

/** Settings → Number format with every kind at 0 decimals (click-through #55). */
function wholeNumbers(): NumberSettings {
  const settings = defaultNumberSettings();
  const decimals = Object.fromEntries(Object.keys(settings.decimals).map((k) => [k, 0])) as NumberSettings["decimals"];
  return { ...settings, decimals };
}

describe("document numbers ignore the display setting (click-through #55)", () => {
  const numbers = wholeNumbers();

  it("DN1 the screen rounds to whole dollars, the document keeps the cents", () => {
    expect(formatNumber("2.57", "money", numbers)).toBe("$3");
    expect(formatDocumentNumber("2.57", "money", numbers)).toBe("$2.57");
    expect(formatDocumentNumber("839", "money", numbers)).toBe("$839.00");
  });

  it("DN2 paid, credit and balance add up to the total as printed", () => {
    const [paid, credit, balance] = ["419.40", "104.25", "315.35"].map((v) =>
      formatDocumentNumber(v, "money", numbers),
    );
    expect([paid, credit, balance]).toEqual(["$419.40", "$104.25", "$315.35"]);
    expect(formatDocumentNumber("839.00", "money", numbers)).toBe("$839.00");
  });

  it("DN3 a unit price prints at its stored precision: at least cents, at most 4 decimals", () => {
    expect(formatDocumentNumber("2.75", "unitPrice", numbers)).toBe("$2.75");
    expect(formatDocumentNumber("2.5700", "unitPrice", numbers)).toBe("$2.57");
    expect(formatDocumentNumber("1.8725", "unitPrice", numbers)).toBe("$1.8725");
    expect(formatDocumentNumber("3", "unitPrice", numbers)).toBe("$3.00");
  });

  it("DN4 quantities and rates keep every stored decimal; negatives keep the company's style", () => {
    expect(formatDocumentNumber("312.75", "quantity", numbers)).toBe("312.75");
    expect(formatDocumentNumber("6.625", "taxRate", numbers)).toBe("6.625%");
    expect(formatDocumentNumber("-12.5", "money", { ...numbers, negativeStyle: "parens" })).toBe("($12.50)");
  });

  it("DN5 the currency's own decimals decide money's precision", () => {
    expect(currencyDecimals({ locale: "en-US", currency: "USD" })).toBe(2);
    expect(currencyDecimals({ locale: "en-US", currency: "JPY" })).toBe(0);
  });
});

describe("an invoice's due date follows the customer's terms (sales.md rule 21, click-through #10)", () => {
  const localization = {
    tax: {
      pricesInclude: "exclusive",
      rounding: "invoice",
      rules: [...EXAMPLE_TAX_RULES],
      jurisdictions: [],
      companyDefault: null,
      filing: [],
      certificateTypes: [],
    },
    region: { statesOfOperation: ["NJ", "CO"] },
  } as unknown as Pick<LocalizationSettings, "tax" | "region">;
  const quote = (depositPct: string) =>
    ({
      id: "q1",
      salesRepId: "u1",
      branchId: "b1",
      jobSite: { street: "", city: "Denver", state: "CO", zip: "80202" },
      lines: [],
      lumpSum: false,
      taxOverride: null,
      depositPct,
    }) as unknown as Quote;
  const customer = (terms: PaymentTerms) =>
    ({ id: "c1", terms, taxExempt: false, certificate: null }) as unknown as Customer;
  const invoice = (terms: PaymentTerms, depositPct = "0") =>
    invoiceFromQuote(quote(depositPct), customer(terms), localization, {
      id: "i1",
      number: "INV-1300",
      issuedAt: "2026-11-21",
      createdBy: "u1",
      balanceDueDays: 30,
    });

  it("DD1 due on receipt is due the day it is issued; net N is N days later", () => {
    expect(invoice("due_on_receipt").dueAt).toBe("2026-11-21");
    expect(invoice("net_15").dueAt).toBe("2026-12-06");
    expect(invoice("net_45").dueAt).toBe("2027-01-05");
  });

  it("DD2 the terms printed beside the date agree with it", () => {
    const plain = invoice("due_on_receipt");
    expect(invoiceTermsText(plain, "due_on_receipt")).toBe("Due on receipt");
    expect(invoiceTermsText(invoice("net_45"), "net_45")).toBe("Net 45");
  });

  it("DD3 a deposit invoice's balance gets the company's balance days, and its terms say so", () => {
    const deposit = invoice("due_on_receipt", "50");
    expect(deposit.dueAt).toBe("2026-12-21");
    expect(invoiceTermsText(deposit, "due_on_receipt")).toBe("Deposit due on receipt, balance in 30 days");
    // Terms longer than the balance days win, and then the label alone is right.
    const net45 = invoice("net_45", "50");
    expect(net45.dueAt).toBe("2027-01-05");
    expect(invoiceTermsText(net45, "net_45")).toBe("Net 45");
  });
});

describe("endSentence (click-through #42)", () => {
  it("ES1 adds a period only when the text does not already end a sentence", () => {
    expect(endSentence("Access saved for Summit Floor Co.")).toBe("Access saved for Summit Floor Co.");
    expect(endSentence("Access saved for Harbor Staffing")).toBe("Access saved for Harbor Staffing.");
    expect(endSentence("Is it done?")).toBe("Is it done?");
    expect(endSentence("Named “Granite Row Inc.”")).toBe("Named “Granite Row Inc.”");
    expect(endSentence("Trailing space  ")).toBe("Trailing space.");
    expect(endSentence("")).toBe("");
  });
});
