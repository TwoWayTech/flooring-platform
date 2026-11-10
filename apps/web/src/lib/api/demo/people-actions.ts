import { newChecklist, OFFBOARDING_STEPS, ONBOARDING_STEPS, SENSITIVE, type Employee } from "@workspace/shared";
import type { EmployeeInput, MyProfilePatch } from "../contract";
import { DemoRuleError } from "./admin-rules";
import { describeFiles, storeFiles, type ActionContext } from "./payment-actions";

function need(ctx: ActionContext, id: string): Employee {
  const employee = ctx.db.get("employees", id);
  if (!employee) throw new DemoRuleError("This employee no longer exists.");
  return employee;
}

/**
 * Adds or edits a person (spec C1 People, ADR 0024). The pay rate changes only with
 * hr.employee.view_sensitive. A 1099 worker is outside overtime law, and a California salary always
 * covers 40 hours (Labor Code 515). Someone without a checklist gets one when they are added.
 */
export async function saveEmployee(ctx: ActionContext, input: EmployeeInput): Promise<Employee> {
  await ctx.assertCan([input.id ? "hr.employee.edit" : "hr.employee.create"]);
  const name = input.name.trim();
  if (!name) throw new DemoRuleError("Enter the person's name.");
  const before = input.id ? need(ctx, input.id) : undefined;
  const mayPay = await ctx.can(SENSITIVE.payRate);
  const id = before?.id ?? ctx.newId("emp");
  const employee: Employee = {
    id,
    companyId: ctx.db.companyId as Employee["companyId"],
    name,
    title: input.title,
    department: input.department,
    workerType: input.workerType,
    payType: input.payType,
    payRate: mayPay ? input.payRate : (before?.payRate ?? "0.00"),
    state: input.state,
    email: input.email,
    phone: input.phone,
    hiredAt: input.hiredAt,
    status: input.status,
    managerId: input.managerId,
    flsaStatus: input.workerType === "1099" ? "not_applicable" : input.flsaStatus,
    exemptionBasis: input.flsaStatus === "exempt" ? input.exemptionBasis : null,
    salaryHoursPerWeek: input.state === "CA" ? 40 : input.salaryHoursPerWeek,
    commissionVisible: input.commissionVisible,
    homeLocationId: input.homeLocationId,
    birthDate: before?.birthDate ?? null,
    emergencyContact: input.emergencyContact,
    documents: before?.documents ?? [],
    onboarding: before?.onboarding ?? newChecklist(ONBOARDING_STEPS, `${id}-on`),
    offboarding: before?.offboarding ?? [],
    ...(before?.externalId ? { externalId: before.externalId } : {}),
  };
  ctx.db.put("employees", employee);
  ctx.audit({
    category: "data",
    action: before ? "Edited employee" : "Added employee",
    target: name,
    before: before?.title ?? null,
    after: employee.title,
  });
  return employee;
}

/** Ticks or unticks a step of a checklist (spec C1). */
export async function setChecklistItem(
  ctx: ActionContext,
  employeeId: string,
  list: "onboarding" | "offboarding",
  itemId: string,
  done: boolean,
) {
  await ctx.assertCan(["hr.employee.edit"]);
  const employee = need(ctx, employeeId);
  const items = employee[list].map((i) => (i.id === itemId ? { ...i, doneAt: done ? ctx.now : null } : i));
  ctx.db.put("employees", { ...employee, [list]: items });
  ctx.audit({
    category: "data",
    action: done ? "Completed checklist step" : "Reopened checklist step",
    target: employee.name,
    before: null,
    after: items.find((i) => i.id === itemId)?.label ?? null,
  });
}

/** Starts offboarding: the checklist appears and the person is marked as having left (ADR 0024). */
export async function startOffboarding(ctx: ActionContext, employeeId: string) {
  await ctx.assertCan(["hr.employee.edit"]);
  const employee = need(ctx, employeeId);
  if (employee.offboarding.length > 0) return employee;
  const saved = ctx.db.put("employees", {
    ...employee,
    status: "terminated",
    offboarding: newChecklist(OFFBOARDING_STEPS, `${employee.id}-off`),
  });
  ctx.audit({
    category: "data",
    action: "Started offboarding",
    target: employee.name,
    before: employee.status,
    after: "terminated",
  });
  return saved;
}

/** Adds documents to a person's file (spec C1 People). */
export async function addEmployeeDocuments(ctx: ActionContext, employeeId: string, files: readonly File[]) {
  await ctx.assertCan(["hr.employee.edit"]);
  const employee = need(ctx, employeeId);
  const metas = await describeFiles(ctx, employee.id, files, employee.documents.length);
  await storeFiles(ctx, metas, files);
  ctx.db.put("employees", { ...employee, documents: [...employee.documents, ...metas] });
  ctx.audit({
    category: "data",
    action: "Added employee documents",
    target: employee.name,
    before: `${employee.documents.length} files`,
    after: metas.map((m) => m.name).join(", "),
  });
}

/** An employee updates their own phone and emergency contact (spec C2 My profile). */
export async function updateMyProfile(ctx: ActionContext, patch: MyProfilePatch) {
  await ctx.assertCan(["hr.portal.view"]);
  const employee = need(ctx, ctx.actor.employeeId ?? "");
  const saved = ctx.db.put("employees", { ...employee, phone: patch.phone, emergencyContact: patch.emergencyContact });
  ctx.audit({
    category: "data",
    action: "Updated own profile",
    target: employee.name,
    before: employee.phone,
    after: patch.phone,
  });
  return saved;
}
