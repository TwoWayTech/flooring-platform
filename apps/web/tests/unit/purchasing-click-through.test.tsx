import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AreaQuantityInput } from "@/components/quantity/area-quantity-input";
import { startsAtTop } from "@/components/shell/scroll-to-top";
import { DamagedLines, DamagedQuantity } from "@/features/purchasing/damaged-quantity";
import { OWED_ON_BILLS, PO_NOT_PAID_HEADER, PO_NOT_PAID_NOTE } from "@/features/purchasing/owed-labels";
import { payAnywayWarning } from "@/features/purchasing/supplier-payment-sheet";

/** The markup's text as it reads on screen: tags out, spaces folded, none before punctuation. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .replace(/ ([,.)])/g, "$1")
    .trim();

describe("a new page starts at the top (click-through #20)", () => {
  it("scrolls on a link to another page", () => {
    expect(startsAtTop({ first: false, fromHistory: false, hash: "" })).toBe(true);
  });

  it("leaves the first render, back and forward, and anchors alone", () => {
    expect(startsAtTop({ first: true, fromHistory: false, hash: "" })).toBe(false);
    expect(startsAtTop({ first: false, fromHistory: true, hash: "" })).toBe(false);
    expect(startsAtTop({ first: false, fromHistory: false, hash: "#lines" })).toBe(false);
  });
});

describe("the orders list says what its money column counts (click-through #21)", () => {
  it("names the column and explains why it is larger than what is owed on bills", () => {
    expect(PO_NOT_PAID_HEADER).toBe("Not yet billed or unpaid");
    expect(OWED_ON_BILLS).toBe("owed to suppliers on bills.");
    expect(PO_NOT_PAID_NOTE).toBe(
      'Owed counts billed amounts only; "Not yet billed or unpaid" also counts goods not billed yet.',
    );
  });
});

describe("a quantity field shows a stored quantity for editing (click-through #22)", () => {
  it("drops the column's trailing zeros", () => {
    const html = renderToStaticMarkup(
      <AreaQuantityInput aria-label="Area" value="19.800" onChange={() => undefined} />,
    );
    expect(html).toContain('value="19.8"');
  });
});

describe("damaged units are shown after the receipt (click-through #24)", () => {
  it("counts whole cartons of a boxed good", () => {
    const html = renderToStaticMarkup(<DamagedQuantity quantity="19.800" unit="sq_ft" sqFtPerCarton="19.80" />);
    expect(text(html)).toBe("1 carton damaged (19.80 sq ft)");
  });

  it("gives the area when it is not whole cartons or there is no carton size", () => {
    expect(text(renderToStaticMarkup(<DamagedQuantity quantity="5" unit="sq_ft" sqFtPerCarton="19.80" />))).toBe(
      "5.00 sq ft damaged",
    );
    expect(text(renderToStaticMarkup(<DamagedQuantity quantity="12" unit="sq_ft" />))).toBe("12.00 sq ft damaged");
  });

  it("lists each damaged receipt line and says it is not billed", () => {
    const html = renderToStaticMarkup(
      <DamagedLines
        lines={[
          {
            receiptId: "r",
            receiptNumber: "GR-0054",
            poLineId: "l",
            description: "Shoreline Plank Linen",
            unit: "sq_ft",
            damaged: "39.600",
            sqFtPerCarton: "19.80",
          },
        ]}
      />,
    );
    expect(text(html)).toBe("GR-0054: Shoreline Plank Linen, 2 cartons damaged (39.60 sq ft). Not billed.");
    expect(renderToStaticMarkup(<DamagedLines lines={[]} />)).toBe("");
  });
});

describe("paying a bill that differs from the goods received (click-through #25)", () => {
  const issue = "Billed $310.00, received goods worth $300.96 (over by $9.04).";

  it("asks to pay anyway, naming the bill and the difference", () => {
    expect(payAnywayWarning([{ number: "TV-1", matchIssues: [issue] }])).toBe(
      `Bill TV-1 differs from the goods received: ${issue} Pay anyway?`,
    );
  });

  it("says nothing when every chosen bill matches", () => {
    expect(payAnywayWarning([{ number: "TV-2", matchIssues: [] }])).toBeNull();
    expect(payAnywayWarning([])).toBeNull();
  });
});
