import { describe, expect, it } from "vitest";
import { SENSITIVE, type PermissionKey, type Role } from "@workspace/shared";
import { hiddenNote } from "@/components/shell/view-as";

/** A custom role holding `permissions`, as the View as banner reads it. */
const role = (...permissions: PermissionKey[]): Role => ({
  id: "role-custom",
  companyId: "summit",
  key: "custom",
  name: "Custom",
  description: "",
  permissions,
  dataScope: "all",
  system: false,
  owner: false,
});

describe("the View as banner says what the role can't see (ADR 0037, 2026-11-17)", () => {
  it.each([
    ["no cost and no margin", role(), "Costs and margins are hidden."],
    ["cost without margin", role(SENSITIVE.productCost), "Margins are hidden."],
    [
      "margin without cost: every margin on a screen needs cost too (seesMargin)",
      role(SENSITIVE.margin),
      "Costs are hidden.",
    ],
    ["both", role(SENSITIVE.margin, SENSITIVE.productCost), ""],
  ])("%s", (_, viewed, note) => {
    expect(hiddenNote(viewed)).toBe(note);
  });
});
