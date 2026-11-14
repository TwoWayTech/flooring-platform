import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Req } from "@nestjs/common";
import type { Request } from "express";
import { z } from "zod";
import type { RequestAccess } from "../../core/access/access.service";
import { Audited, RequireModule, RequirePermission } from "../../core/access/permission.decorators";
import { CurrentAccess } from "../../core/access/permission.guard";
import { actorOf, parse } from "../../core/access/request-actor";
import { CurrentSession } from "../../core/auth/session.guard";
import type { AuthSession } from "../../core/auth/session.service";
import { CurrentTenant, type TenantContext } from "../../core/tenancy/tenant-context";
import { DAY, requireFeature } from "../sales/sales-common";
import { FILES, MONEY, requireAnyFeature } from "./hr-input";
import { PeopleService } from "./people.service";

/**
 * A person as the form sends it (hr.md "Employee"). Strict: an unknown field, such as a Social
 * Security or bank account number, is refused, so none is ever stored (CLAUDE.md rule 14).
 */
const EMPLOYEE = z
  .object({
    name: z.string().max(120),
    title: z.string().max(120),
    department: z.string().max(120),
    workerType: z.enum(["w2", "1099"]),
    payType: z.enum(["hourly", "salary", "per_job"]),
    payRate: MONEY.optional(),
    state: z.string().max(2),
    email: z.union([z.literal(""), z.email("Enter a valid email.").max(254)]),
    phone: z.string().max(40),
    hiredAt: DAY,
    status: z.enum(["active", "on_leave", "terminated"]),
    managerId: z.uuid().nullable(),
    flsaStatus: z.enum(["non_exempt", "exempt", "not_applicable"]),
    exemptionBasis: z.enum(["executive", "administrative", "professional", "outside_sales"]).nullable(),
    salaryHoursPerWeek: z.number().int().min(1).max(60),
    commissionVisible: z.boolean().nullable(),
    homeLocationId: z.uuid().nullable(),
    emergencyContact: z
      .object({ name: z.string().max(120), phone: z.string().max(40), relation: z.string().max(60) })
      .strict()
      .nullable(),
    userId: z.uuid().nullable().optional(),
  })
  .strict();

const CHECKLIST = z.object({ list: z.enum(["onboarding", "offboarding"]), done: z.boolean() }).strict();

const DOCUMENTS = z.object({ files: FILES }).strict();

/**
 * HR → People (hr.md "People"; ADR 0046), in the `hr` module, so it serves Flooring Suite
 * companies with HR and HR Suite companies alike. Every write is audited in its own transaction.
 */
@Controller()
@RequireModule("hr")
export class PeopleController {
  constructor(private readonly people: PeopleService) {}

  /** GET /employees: everyone with hr.employee.view, else the people the person's scope covers. */
  @Get("employees")
  @RequirePermission("hr.employee.view", "hr.timesheet.view", "hr.pto.view", "settings.hr.manage")
  list(@CurrentTenant() tenant: TenantContext, @CurrentAccess() access: RequestAccess) {
    requireAnyFeature("hr.employees", "hr.timesheets", "hr.time-off", "settings.hr");
    return this.people.list(tenant, access);
  }

  /** POST /employees: adds a person with the onboarding checklist. */
  @Post("employees")
  @RequirePermission("hr.employee.create")
  @Audited()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Body() body: unknown,
  ) {
    requireFeature("hr.employees");
    return this.people.save(tenant, actorOf(access, session, request), null, parse(EMPLOYEE, body));
  }

  /** PUT /employees/:id: edits a person; the pay rate changes only with view_sensitive. */
  @Put("employees/:id")
  @RequirePermission("hr.employee.edit")
  @Audited()
  update(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("hr.employees");
    return this.people.save(tenant, actorOf(access, session, request), id, parse(EMPLOYEE, body));
  }

  /** POST /employees/:id/checklist/:itemId: ticks or unticks a step. */
  @Post("employees/:id/checklist/:itemId")
  @RequirePermission("hr.employee.edit")
  @Audited()
  checklist(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Param("itemId", new ParseUUIDPipe()) itemId: string,
    @Body() body: unknown,
  ) {
    requireFeature("hr.employees");
    const input = parse(CHECKLIST, body);
    return this.people.setChecklistItem(tenant, actorOf(access, session, request), id, { ...input, itemId });
  }

  /** POST /employees/:id/offboarding: marks the person as left and adds the offboarding checklist. */
  @Post("employees/:id/offboarding")
  @RequirePermission("hr.employee.edit")
  @Audited()
  offboard(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
  ) {
    requireFeature("hr.employees");
    return this.people.startOffboarding(tenant, actorOf(access, session, request), id);
  }

  /** POST /employees/:id/documents: adds files to the person's documents (read through GET /files/:id). */
  @Post("employees/:id/documents")
  @RequirePermission("hr.employee.edit")
  @Audited()
  documents(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAccess() access: RequestAccess,
    @CurrentSession() session: AuthSession,
    @Req() request: Request,
    @Param("id", new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ) {
    requireFeature("hr.employees");
    return this.people.addDocuments(tenant, actorOf(access, session, request), id, parse(DOCUMENTS, body).files);
  }
}
