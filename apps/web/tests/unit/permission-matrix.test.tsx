import { isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PermissionKey } from "@workspace/shared";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { boxToggle, cellName, PermissionMatrix, type CellLock } from "@/features/settings/roles/permission-matrix";

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

/** Every element in a tree that carries a checkbox's `onCheckedChange`, with its props. */
function checkboxProps(node: ReactNode): CheckboxProps[] {
  if (Array.isArray(node)) return node.flatMap(checkboxProps);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode } & Partial<CheckboxProps>;
  const own = props.onCheckedChange ? [props as CheckboxProps] : [];
  return [...own, ...checkboxProps(props.children)];
}

interface CheckboxProps {
  "aria-label": string;
  checked: boolean;
  onCheckedChange: (on: boolean | "indeterminate") => void;
}

describe("a locked box never changes (click-through #53)", () => {
  it("a click or Space on a tooltip-locked box calls nothing and keeps its tick", () => {
    const toggled: string[] = [];
    const granted: PermissionKey[] = ["wholesale.price_list.view"];
    const props = () =>
      checkboxProps(
        PermissionMatrix({
          modules: ["wholesale"],
          granted,
          lockOf: () => "module",
          onToggle: (key, on) => toggled.push(`${key}:${on}`),
        }),
      );
    const ticked = props().find((p) => p["aria-label"].startsWith("View price lists"));
    expect(ticked?.checked).toBe(true);
    // Radix calls onCheckedChange for a click and for Space alike, with the flipped value.
    ticked!.onCheckedChange(false);
    ticked!.onCheckedChange(false);
    for (const box of props()) box.onCheckedChange(!box.checked);
    expect(toggled).toEqual([]);
    expect(props().find((p) => p["aria-label"].startsWith("View price lists"))?.checked).toBe(true);
  });

  it("an unlocked box still toggles", () => {
    const toggled: string[] = [];
    boxToggle("wholesale.price_list.view", null, (key, on) => toggled.push(`${key}:${on}`))(true);
    boxToggle("wholesale.price_list.view", "plan", (key, on) => toggled.push(`${key}:${on}`))(true);
    expect(toggled).toEqual(["wholesale.price_list.view:true"]);
  });
});
