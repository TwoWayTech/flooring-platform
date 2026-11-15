import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ADMIN_REASON_MESSAGE,
  EXPECTED_STATUS_LENGTH,
  STATUS_ACTION_MESSAGES as S,
  statusActionBodyProblem,
  type CompanyStatusAction,
  type PlatformCompany,
  type PlatformCompanyStatus,
} from "@workspace/shared";
import { z } from "zod";
import { parse } from "../../core/access/request-actor";
import { SessionOnly } from "../../core/tenancy/access";
import { CompanyStatusService, type StatusActionBody } from "./company-status.service";
import { CurrentPlatformAdmin, PlatformAdminGuard, PlatformFeature, type PlatformActor } from "./platform-admin.guard";

/**
 * The status action fields' shapes (spec part 2, "Bodies"): each type error and length bound
 * carries its field's message. `expectedStatus` comes first, so a body wrong in both places answers
 * its message first, as the shared `statusActionBodyProblem` does. It is text, not one of the five
 * statuses, so a stored status the console doesn't know still reaches the 422. The bounds only keep
 * oversized input out; the trimmed 10 to 500 characters of the reason are the shared rule's.
 */
const STATUS_FIELDS = {
  expectedStatus: z
    .string({ error: S.expectedStatus })
    .min(EXPECTED_STATUS_LENGTH.min, S.expectedStatus)
    .max(EXPECTED_STATUS_LENGTH.max, S.expectedStatus),
  reason: z.string({ error: ADMIN_REASON_MESSAGE }).max(2000, ADMIN_REASON_MESSAGE),
};

/** Suspend and reinstate, strict: a `confirmName` or any other field answers 400. */
const STATUS_BODY = z.strictObject(STATUS_FIELDS);

/** Cancel, strict, with the typed company name the service checks against the locked row. */
const CANCEL_BODY = z.strictObject({
  ...STATUS_FIELDS,
  confirmName: z.string({ error: S.confirmName }).max(200, S.confirmName),
});

/** The status preview takes no query: any parameter answers 400. */
const NO_QUERY = z.strictObject({});

/**
 * A status action's body: the strict shape, then the shared body rule (spec part 2, refusal order
 * step 5), both before the company is read; 400 `invalid_request` with the first problem.
 */
function checkedBody(action: CompanyStatusAction, body: unknown): StatusActionBody {
  const parsed: StatusActionBody = action === "cancel" ? parse(CANCEL_BODY, body) : parse(STATUS_BODY, body);
  const problem = statusActionBodyProblem(action, parsed);
  if (problem) throw new BadRequestException({ code: "invalid_request", message: problem });
  return parsed;
}

/**
 * A company's status in the console (docs/specs/platform-admin.md, part 2, "Company status"; ADR
 * 0056): the preview, and suspend, reinstate and cancel. A second controller on part 1's
 * `platform/companies` prefix, whose paths don't clash with `:id`, `:id/access` or `:id/directory`.
 * Like every /platform controller it is session-only behind PlatformAdminGuard at class level, and
 * it carries the `admin.billing` switch there too, so a handler added later inherits both: switched
 * off, every route answers 404 before the admin row is read. Any platform admin reads the preview;
 * the owner role acts after a step-up (the guard's default write roles). `:id` is a UUID (400) that
 * names control rows only, never a company database. The actions answer 200: they create nothing.
 */
@Controller("platform/companies")
@SessionOnly()
@UseGuards(PlatformAdminGuard)
@PlatformFeature("admin.billing")
export class PlatformCompanyStatusController {
  constructor(private readonly status: CompanyStatusService) {}

  /** GET /platform/companies/:id/status: the status, the phase and what each action would do, never cached. */
  @Get(":id/status")
  @Header("Cache-Control", "no-store")
  preview(
    @Param("id", new ParseUUIDPipe()) companyId: string,
    @Query() query: unknown,
  ): Promise<PlatformCompanyStatus> {
    parse(NO_QUERY, query);
    return this.status.preview(companyId);
  }

  /** POST /platform/companies/:id/suspend: the owner role suspends a company with a reason. */
  @Post(":id/suspend")
  @HttpCode(200)
  suspend(
    @CurrentPlatformAdmin() admin: PlatformActor,
    @Param("id", new ParseUUIDPipe()) companyId: string,
    @Body() body: unknown,
  ): Promise<PlatformCompany> {
    return this.status.act(admin, companyId, "suspend", checkedBody("suspend", body));
  }

  /** POST /platform/companies/:id/reinstate: the owner role reinstates a suspended or cancelled company. */
  @Post(":id/reinstate")
  @HttpCode(200)
  reinstate(
    @CurrentPlatformAdmin() admin: PlatformActor,
    @Param("id", new ParseUUIDPipe()) companyId: string,
    @Body() body: unknown,
  ): Promise<PlatformCompany> {
    return this.status.act(admin, companyId, "reinstate", checkedBody("reinstate", body));
  }

  /** POST /platform/companies/:id/cancel: the owner role cancels a company with its typed name; nothing is deleted. */
  @Post(":id/cancel")
  @HttpCode(200)
  cancel(
    @CurrentPlatformAdmin() admin: PlatformActor,
    @Param("id", new ParseUUIDPipe()) companyId: string,
    @Body() body: unknown,
  ): Promise<PlatformCompany> {
    return this.status.act(admin, companyId, "cancel", checkedBody("cancel", body));
  }
}
