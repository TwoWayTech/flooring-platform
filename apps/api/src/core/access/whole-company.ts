import { ForbiddenException } from "@nestjs/common";
import { SETTINGS_SCOPE_MESSAGE } from "@workspace/shared";
import type { RequestAccess } from "./access.service";

/**
 * Refuses anyone below data scope `all` with 403 and the settings words, whatever key their role
 * holds (CLAUDE.md rule 3). Settings bind the whole company, so every settings save needs it (ADR
 * 0059 D4), as the books do (ADR 0040); Warehouses and showrooms use it too (ADR 0059, part 4a, D23),
 * and so do the whole company's Outbox and its Send again and Cancel (ADR 0059, the bell and Outbox
 * part, security review round 2). One copy, so the checks can't drift apart (round 4).
 */
export function requireWholeCompany(access: Pick<RequestAccess, "dataScope">): void {
  if (access.dataScope !== "all") throw new ForbiddenException({ code: "forbidden", message: SETTINGS_SCOPE_MESSAGE });
}
