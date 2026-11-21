import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PermissionKey } from "@workspace/shared";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { cellName, PermissionMatrix, type CellLock } from "@/features/settings/roles/permission-matrix";

/** The wholesale matrix with View price lists ticked, every box locked by `lock`. */
function wholesale(lock: CellLock): string {
  const granted: PermissionKey[] = ["wholesale.price_list.view"];
  return renderToStaticMarkup(
    <TooltipProvider>
      <PermissionMatrix modules={["wholesale"]} granted={granted} lockOf={() => lock} onToggle={() => undefined} />
    </TooltipProvider>,
  );
}

/** Each checkbox's opening tag in the markup. */
function boxes(html: string): string[] {
  return html.match(/<button[^>]*role="checkbox"[^>]*>/g) ?? [];
}

describe("permission matrix box names (click-through #53)", () => {
  it("names a locked box by its permission, then the reason", () => {
    expect(cellName({ label: "View price lists" }, "module")).toBe(
      "View price lists, Module not switched on for this company",
    );
    expect(cellName({ label: "View price lists" }, null)).toBe("View price lists");
  });

  it("a ticked box of a switched-off module is the focus stop and carries its permission's name", () => {
    const html = wholesale("module");
    const ticked = boxes(html).find((tag) => tag.includes('aria-checked="true"'));
    expect(ticked).toContain('aria-label="View price lists, Module not switched on for this company"');
    expect(ticked).toContain('aria-disabled="true"');
    // No unnamed wrapper takes focus in the box's place (its tooltip would name it instead).
    expect(html).not.toMatch(/<span[^>]*tabindex="0"/);
    for (const tag of boxes(html)) expect(tag).toMatch(/aria-label="[^"]+, Module not switched on for this company"/);
  });

  it("a box locked for the whole matrix stays disabled with its name", () => {
    const ticked = boxes(wholesale("owner")).find((tag) => tag.includes('aria-checked="true"'));
    expect(ticked).toContain('aria-label="View price lists, The Owner role always holds everything in your plan"');
    expect(ticked).toContain('disabled=""');
  });
});
