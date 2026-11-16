import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { invoiceLedger, type Reservation } from "@workspace/shared";
import { InvoiceStock } from "@/features/invoices/invoice-stock";
import { loadCompanyFixtures } from "@/lib/api/demo/fixtures";
import { reservationSummary } from "@/lib/api/demo/inventory-actions";

// The panel's buttons only call the ApiClient when clicked; the viewer may cut and override.
vi.mock("@/lib/api", () => ({ api: {} }));
vi.mock("@/components/workspace/workspace-context", () => ({ useCan: () => () => true }));

const summit = await loadCompanyFixtures("summit");
/** A roll hold from the Summit fixtures, with its invoice: the panel needs the line, product and roll. */
const seeded = summit.reservations.find((r) => r.rollId && r.status === "active")!;
const invoice = summit.invoices.find((i) => i.id === seeded.invoiceId)!;

/** The roll hold as the API sends it: numeric(14,3) columns at their scale, so a full hold's shortBy is "0.000". */
const held: Reservation = { ...seeded, quantity: "40.000", shortBy: "0.000" };
/** What no roll could cover: a short row holds nothing (inventory.md rule 11). */
const short: Reservation = { ...seeded, id: "res-short", rollId: null, quantity: "0.000", shortBy: "12.500" };

/** The invoice paid in full, so stock may leave and the panel offers Cut (inventory.md rule 13). */
const paid = invoiceLedger(
  invoice,
  {
    payments: [
      { invoiceId: invoice.id, status: "confirmed", amount: invoice.total, date: invoice.issuedAt, kind: "payment" },
    ],
    adjustments: [],
  },
  invoice.issuedAt,
);

/** The text of each body row of the panel as it reads on screen: tags out, no space before a comma. */
function rows(reservations: Reservation[]): string[] {
  const html = renderToStaticMarkup(
    <InvoiceStock
      invoice={invoice}
      ledger={paid}
      reservations={reservations}
      products={summit.products}
      rolls={summit.rolls}
      locations={summit.locations}
    />,
  );
  const body = html.slice(html.indexOf("<tbody"));
  return body
    .split(/<tr[^>]*>/)
    .slice(1)
    .map((row) =>
      row
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .replace(/ ,/g, ",")
        .trim(),
    );
}

describe("the invoice's Stock panel reads shortfalls by value (inventory.md rule 11; STATUS B3)", () => {
  it('shows a hold the API answers with shortBy "0.000" as reserved, ready to cut', () => {
    const [row] = rows([held]);
    expect(row).toContain("Reserved");
    expect(row).not.toContain("Short by");
    expect(row).toMatch(/Cut$/);
  });

  it("shows a short row as short by what is missing, with nothing to cut (inventory.md rule 15)", () => {
    const [, row] = rows([held, short]);
    expect(row).toContain("Short by 12.50 ft, not reserved");
    expect(row).not.toMatch(/Cut$/);
  });
});

describe("the demo's audit line counts short holds by value (STATUS B3)", () => {
  it("counts only the rows that are short, whatever their scale", () => {
    expect(reservationSummary([held, { ...held, shortBy: "0" }])).toBe("2 reserved");
    expect(reservationSummary([held, short])).toBe("2 reserved, 1 short");
  });
});
