import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  computeTotals,
  defaultNumberSettings,
  EXAMPLE_TAX_RULES,
  formatNumber,
  ruleForState,
  SENSITIVE,
  type DocLine,
  type NumberKind,
  type PermissionKey,
  type TaxContext,
  type ViewedDocLine,
} from "@workspace/shared";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { WorkspaceContext, type Workspace } from "@/components/workspace/workspace-context";
import { QuoteSummary } from "@/features/quotes/quote-summary";

const CO: TaxContext = { rule: ruleForState(EXAMPLE_TAX_RULES, "CO"), exempt: false, rounding: "line" };

/** 100 sq ft of tile at 4.50 (cost 2.10) and 100 sq ft of installation at 1.75 (cost 1.00). */
const WITH_COST: DocLine[] = [
  {
    id: "tile",
    description: "Slate Tile",
    category: "material",
    unit: "sq_ft",
    quantity: "100",
    unitPrice: "4.50",
    unitCost: "2.10",
  },
  {
    id: "install",
    description: "Installation",
    category: "labor",
    unit: "sq_ft",
    quantity: "100",
    unitPrice: "1.75",
    unitCost: "1.00",
  },
];

/** The same lines as the API sends them to someone without product cost (CLAUDE.md rule 5). */
const WITHOUT_COST: ViewedDocLine[] = WITH_COST.map((line) => {
  const viewed: ViewedDocLine = { ...line };
  delete viewed.unitCost;
  return viewed;
});

/**
 * The summary's markup for a viewer holding `held`, over `lines`. It renders inside the real
 * workspace context, so the component's own `useCan` reads the keys.
 */
function summary(held: readonly PermissionKey[], lines: readonly ViewedDocLine[]): string {
  const workspace = { access: { permissions: new Set<PermissionKey>(held) } } as unknown as Workspace;
  return renderToStaticMarkup(
    <TooltipProvider>
      <WorkspaceContext.Provider value={workspace}>
        <QuoteSummary
          totals={computeTotals(lines, CO)}
          ctx={CO}
          state="CO"
          depositPct="50"
          editable={false}
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

/** The markup's text with the tags taken out. */
const text = (html: string) => html.replace(/<[^>]+>/g, "");

/** How `<Num>` shows a value of `kind` with the default number settings. */
const shown = (value: string, kind: NumberKind) => formatNumber(value, kind, defaultNumberSettings());

const BOTH = [SENSITIVE.margin, SENSITIVE.productCost];

describe("the quote summary's margin row (sales.md See margin on a quote; ADR 0037, 2026-11-16)", () => {
  it("shows a salesperson the total and deposit, and no margin or cost, when the API withheld cost", () => {
    const html = summary([], WITHOUT_COST);
    // 450.00 + 175.00, with Colorado's tax on the tile only.
    const total = computeTotals(WITH_COST, CO).total;
    expect(text(html)).toContain(shown(total, "money"));
    expect(text(html)).toContain("Deposit");
    expect(html).not.toContain("<dt>Margin</dt>");
    expect(text(html)).not.toContain("Cost");
  });

  it("shows no margin to someone holding both keys while a line's cost was withheld", () => {
    const html = summary(BOTH, WITHOUT_COST);
    expect(html).not.toContain("<dt>Margin</dt>");
    expect(text(html)).not.toContain("Cost");
  });

  it("shows no margin with the margin key alone, because margin gives the cost away", () => {
    const html = summary([SENSITIVE.margin], WITH_COST);
    expect(html).not.toContain("<dt>Margin</dt>");
    expect(text(html)).not.toContain("Cost");
  });

  it("shows the margin, its percent and the cost under it with both keys and every cost known", () => {
    const html = summary(BOTH, WITH_COST);
    expect(html).toContain("<dt>Margin</dt>");
    // 625.00 less 310.00 = 315.00, which is 50.4 % of 625.00.
    expect(text(html)).toContain(`${shown("315.00", "money")} (${shown("50.4", "percent")})`);
    expect(text(html)).toContain(`Cost ${shown("310.00", "money")}`);
  });
});
