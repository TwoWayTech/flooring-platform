import { describe, expect, it } from "vitest";
import { workspaceRefusal } from "@/components/workspace/workspace-refusal";
import { DemoRuleError } from "@/lib/api/demo/admin-rules";
import { ApiError } from "@/lib/api/errors";
import { HttpApiError } from "@/lib/api/http/transport";
import { STANDING_REFUSAL_CODES } from "@/lib/api/standing-watch";

const refused = (code: string, status = 403) => new HttpApiError(`Refused with ${code}.`, status, code);

describe("a refused first read of GET /company (ADR 0051, 'GET /company', D17)", () => {
  it("R1 the standing refusals show the company-unavailable panel for their state", () => {
    expect(workspaceRefusal(refused("company_maintenance", 503))).toEqual({ kind: "standing", state: "maintenance" });
    expect(workspaceRefusal(refused("company_unavailable", 503))).toEqual({ kind: "standing", state: "unavailable" });
    expect(workspaceRefusal(refused("company_suspended"))).toEqual({ kind: "standing", state: "locked" });
  });

  it("R2 any other API refusal shows the API's own message", () => {
    for (const code of ["forbidden", "mfa_enrolment_required", "company_read_only"]) {
      expect(workspaceRefusal(refused(code))).toEqual({ kind: "message", message: `Refused with ${code}.` });
    }
  });

  it("R3 a network failure or a demo refusal shows its message", () => {
    expect(workspaceRefusal(new Error("fetch failed"))).toEqual({ kind: "message", message: "fetch failed" });
    expect(workspaceRefusal(new ApiError("Your profile is not in this company."))).toEqual({
      kind: "message",
      message: "Your profile is not in this company.",
    });
    expect(workspaceRefusal(new DemoRuleError("No."))).toEqual({ kind: "message", message: "No." });
  });

  it("R4 every standing refusal code but a read-only write's maps to a blocking state", () => {
    for (const code of STANDING_REFUSAL_CODES) {
      if (code === "company_read_only") continue;
      expect(workspaceRefusal(refused(code)).kind, code).toBe("standing");
    }
  });
});
