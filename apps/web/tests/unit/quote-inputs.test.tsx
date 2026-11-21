import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { computeTotals, EXAMPLE_TAX_RULES, ruleForState, type DocLine, type TaxContext } from "@workspace/shared";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { WorkspaceContext, type Workspace } from "@/components/workspace/workspace-context";
import { LinesEditor } from "@/features/quotes/lines-editor";
import { QuoteSummary } from "@/features/quotes/quote-summary";

const CO: TaxContext = { rule: ruleForState(EXAMPLE_TAX_RULES, "CO"), exempt: false, rounding: "line" };

/** A typed tile line as the API answers it after a save: quantity (14,3) and waste at their scale. */
const LINE: DocLine = {
  id: "tile",
  description: "Slate Tile",
  category: "material",
  unit: "sq_ft",
  quantity: "108.000",
  unitPrice: "4.5000",
  unitCost: "2.1000",
  wastePct: "8.000",
};

/** The `value` attribute of the input labelled `label` in the markup. */
function inputValue(html: string, label: string): string | undefined {
  const input = html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`))?.[0];
  return input?.match(/value="([^"]*)"/)?.[1];
}

/** The class attribute of the input labelled `label` in the markup. */
function inputClass(html: string, label: string): string | undefined {
  const input = html.match(new RegExp(`<input[^>]*aria-label="${label}"[^>]*>`))?.[0];
  return input?.match(/class="([^"]*)"/)?.[1];
}

function lines(wastePct: string): string {
  return renderToStaticMarkup(
    <LinesEditor
      lines={[{ ...LINE, wastePct }]}
      rooms={[]}
      products={[]}
      totals={computeTotals([LINE], CO)}
      editable
      onAdd={() => undefined}
      onChange={() => undefined}
      onRemove={() => undefined}
      showWaste
      stock={{ rolls: [], movements: [], reservations: [] }}
      locationId="loc-1"
      locations={[]}
      canTransfer={false}
      onTransfer={() => undefined}
    />,
  );
}

function summary(depositPct: string): string {
  const workspace = { access: { permissions: new Set() } } as unknown as Workspace;
  return renderToStaticMarkup(
    <TooltipProvider>
      <WorkspaceContext.Provider value={workspace}>
        <QuoteSummary
          totals={computeTotals([LINE], CO)}
          ctx={CO}
          state="CO"
          depositPct={depositPct}
          editable
          override={null}
          canOverride={false}
          onOverride={() => undefined}
          onDeposit={() => undefined}
          actions={null}
        />
      </WorkspaceContext.Provider>
    </TooltipProvider>,
  );
}

describe("the quote's waste and deposit inputs after a save (click-through finding #7)", () => {
  it("QI1 the waste input shows 8, not the stored 8.000, in a box wide enough for 100.25", () => {
    const html = lines("8.000");
    expect(inputValue(html, "Slate Tile waste percent")).toBe("8");
    expect(inputClass(html, "Slate Tile waste percent")).toContain("max-w-[4.5rem]");
    expect(inputValue(lines("12.500"), "Slate Tile waste percent")).toBe("12.5");
  });

  it("QI2 the deposit input shows 50, not the stored 50.00 or 50.00000000, in a wider box", () => {
    expect(inputValue(summary("50.00"), "Deposit percent")).toBe("50");
    expect(inputValue(summary("50.00000000"), "Deposit percent")).toBe("50");
    expect(inputValue(summary("33.5"), "Deposit percent")).toBe("33.5");
    expect(inputClass(summary("50.00"), "Deposit percent")).toContain("w-20");
  });
});

describe("the quote's Lines table (click-through finding #6)", () => {
  it("QI3 has a fixed layout with narrow set widths on the numeric columns and none on Item", () => {
    const html = lines("8");
    expect(html).toMatch(/<table class="[^"]*table-fixed/);
    const cols = [...html.matchAll(/<col( class="([^"]*)")?\/?>/g)].map((match) => match[2] ?? "");
    expect(cols).toEqual(["", "w-[6.5rem]", "w-[5.5rem]", "w-[5rem]", "w-[5.5rem]", "w-10"]);
  });
});
