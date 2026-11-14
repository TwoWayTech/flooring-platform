import { ForbiddenException } from "@nestjs/common";
import type { RequestAccess } from "../../core/access/access.service";

/**
 * The books and how they are kept are company-wide and cannot be cut to one branch, so they are for
 * people whose data scope is the whole company (CLAUDE.md rule 3; PR #16 and PR #19 reviews).
 * Anyone else gets 403, whatever permission their role holds.
 */
export function requireCompanyWide(access: RequestAccess): void {
  if (access.dataScope !== "all") {
    throw new ForbiddenException({ code: "forbidden", message: "The books cover the whole company." });
  }
}
