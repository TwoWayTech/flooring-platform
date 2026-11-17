import { describe, expect, it } from "vitest";
import type { Branch } from "@workspace/shared";
import { inviteBranches } from "@/features/settings/users/invite-branches";

const SPRINGS: Branch = { id: "b-springs", name: "Colorado Springs", city: "Colorado Springs", state: "CO" };
const DENVER: Branch = { id: "b-denver", name: "Denver", city: "Denver", state: "CO" };
const BRANCHES = [SPRINGS, DENVER];

describe("the invite dialog's branches (ADR 0051, 'GET /company', D18)", () => {
  it("I1 scope all: every branch, starting at the inviter's own", () => {
    expect(inviteBranches(BRANCHES, { branchId: DENVER.id }, { dataScope: "all" })).toEqual({
      branches: BRANCHES,
      defaultId: DENVER.id,
    });
  });

  it("I2 scope branch: only the inviter's own branch", () => {
    expect(inviteBranches(BRANCHES, { branchId: DENVER.id }, { dataScope: "branch" })).toEqual({
      branches: [DENVER],
      defaultId: DENVER.id,
    });
  });

  it("I3 scope own: only the inviter's own branch", () => {
    expect(inviteBranches(BRANCHES, { branchId: SPRINGS.id }, { dataScope: "own" })).toEqual({
      branches: [SPRINGS],
      defaultId: SPRINGS.id,
    });
  });

  it("I4 scope branch with no branch of one's own: nothing to pick, stored as no branch", () => {
    expect(inviteBranches(BRANCHES, { branchId: "" }, { dataScope: "branch" })).toEqual({
      branches: [],
      defaultId: "",
    });
  });

  it("I5 scope all whose own branch isn't listed: every branch, starting at the first", () => {
    expect(inviteBranches(BRANCHES, { branchId: "sm-br-denver" }, { dataScope: "all" })).toEqual({
      branches: BRANCHES,
      defaultId: SPRINGS.id,
    });
  });
});
