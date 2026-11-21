import { inflateSync } from "node:zlib";
import { Document, Page, renderToBuffer, Text } from "@react-pdf/renderer";
import { describe, expect, it } from "vitest";
import { invoiceLedger, type CompanySettings, type DocLine, type NumberSettings } from "@workspace/shared";
import { buildInvoiceModel } from "@/features/invoices/invoice-model";
import { InvoicePdf } from "@/features/invoices/invoice-pdf";
import { pdfText } from "@/lib/pdf-text";
import { loadCompanyFixtures } from "@/lib/api/demo/fixtures";

const summit = await loadCompanyFixtures("summit");

/** Settings → Number format with money and every other kind at 0 decimals (click-through #55). */
function wholeNumbers(settings: CompanySettings): CompanySettings {
  const decimals = Object.fromEntries(
    Object.keys(settings.numbers.decimals).map((k) => [k, 0]),
  ) as NumberSettings["decimals"];
  return { ...settings, numbers: { ...settings.numbers, decimals } };
}

/** Windows-1252 bytes 0x80 to 0x9F, so the extracted text reads like the printed page. */
const CP1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";
const decodeByte = (b: number) => (b >= 0x80 && b <= 0x9f ? CP1252[b - 0x80]! : String.fromCharCode(b));

/**
 * The text a PDF viewer would extract: every content stream inflated, then the hex strings of
 * each text-showing operator decoded as WinAnsi, joined by single spaces. Enough for the standard
 * fonts @react-pdf/renderer uses; no PDF library needed.
 */
function pdfPlainText(pdf: Buffer): string {
  const raw = pdf.toString("latin1");
  const shown: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = match.index! + match[0].length;
    const end = raw.indexOf("endstream", start);
    let content: string;
    try {
      content = inflateSync(pdf.subarray(start, end)).toString("latin1");
    } catch {
      continue;
    }
    for (const op of content.matchAll(/\[([^\]]*)\]\s*TJ|<([0-9a-fA-F]*)>\s*Tj/g)) {
      const hex = [...(op[1] ?? `<${op[2]}>`).matchAll(/<([0-9a-fA-F]*)>/g)].map((h) => h[1]).join("");
      shown.push(hex.replace(/../g, (pair) => decodeByte(parseInt(pair, 16))));
    }
  }
  return shown.join(" ").replace(/\s+/g, " ");
}

describe("the invoice PDF (click-through #11 and #55)", () => {
  const source = summit.invoices.find((i) => !i.voidedAt && !i.isReturn)!;
  const template = source.lines[0]!;
  const boxed: DocLine = {
    ...template,
    id: "boxed",
    description: "Oak plank, boxed",
    unit: "sq_ft",
    quantity: "189.12",
    unitPrice: "2.57",
    sqFtPerCarton: "23.64",
  };
  const labor: DocLine = {
    ...template,
    id: "labor",
    description: "Installation",
    unit: "sq_ft",
    quantity: "189.12",
    unitPrice: "2.75",
  };
  const invoice = { ...source, lines: [boxed, labor] };
  const customer = summit.customers.find((c) => c.id === invoice.customerId)!;
  const ledger = invoiceLedger(invoice, { payments: [], adjustments: [] }, invoice.issuedAt);
  const model = buildInvoiceModel(
    invoice,
    ledger,
    customer,
    undefined,
    [],
    wholeNumbers(summit.settings),
    "America/Denver",
  );

  it("PDF1 the screen model keeps exact prices and the carton sign at 0-decimal display", () => {
    expect(model.lines.map((l) => l.price)).toEqual(["$2.57", "$2.75"]);
    expect(model.lines[0]!.cartons).toBe("≈ 8 cartons");
    expect(model.total).toMatch(/\.\d\d$/);
  });

  it("PDF2 the printed text holds the cents and 'about 8 cartons', never a stray H", async () => {
    const text = pdfPlainText(await renderToBuffer(<InvoicePdf model={model} />));
    expect(text).toContain("$2.57");
    expect(text).toContain("$2.75");
    expect(text).toContain(model.total);
    expect(text).toContain("about 8 cartons");
    expect(text).not.toMatch(/H ?8 cartons/);
  }, 30_000);

  it("PDF3 the check above can fail: raw '≈' prints as the H the click-through saw", async () => {
    const raw = await renderToBuffer(
      <Document>
        <Page>
          <Text>≈ 8 cartons</Text>
        </Page>
      </Document>,
    );
    expect(pdfPlainText(raw)).toMatch(/H ?8 cartons/);
  }, 30_000);

  it("PDF4 the other signs documents use print as themselves", async () => {
    const signs = "2 × 3 – 4 — it’s “quoted” • more…";
    const raw = await renderToBuffer(
      <Document>
        <Page>
          <Text>{pdfText(signs)}</Text>
        </Page>
      </Document>,
    );
    expect(pdfPlainText(raw)).toContain(signs);
  }, 30_000);
});

describe("pdfText (click-through #11)", () => {
  it("PT1 keeps the signs the PDF font holds and words the ones it lacks", () => {
    expect(pdfText("2 × 3 – 4 — ’“”• …")).toBe("2 × 3 – 4 — ’“”• …");
    expect(pdfText("≈ 8 cartons")).toBe("about 8 cartons");
    expect(pdfText("−5 ≤ 6 → ✓")).toBe("-5 <= 6 -> yes");
    expect(pdfText("漢")).toBe("?");
  });
});
