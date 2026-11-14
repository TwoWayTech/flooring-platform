import { addDays, type Employee } from "@workspace/shared";
import { and, eq, isNull } from "drizzle-orm";
import type { CompanyDb } from "../client";
import {
  clockEntries,
  employeeChecklistItems,
  employees,
  ptoRequests,
  timeEntries,
  timeOffEntries,
  timeOffPolicies,
  timesheets,
  userProfiles,
} from "../company";
import { seedId, type DemoCompany } from "./fixtures";
import { userOf, utc } from "./values";

/**
 * Employees in an order where each manager comes before their reports, so the self-reference holds
 * as rows go in. A manager outside the list (or a loop) is left for last and seeded without one.
 */
function managersFirst(list: readonly Employee[]): Employee[] {
  const ids = new Set(list.map((e) => e.id));
  const placed = new Set<string>();
  const ordered: Employee[] = [];
  let left = [...list];
  while (left.length > 0) {
    const ready = left.filter((e) => !e.managerId || !ids.has(e.managerId) || placed.has(e.managerId));
    const next = ready.length > 0 ? ready : left;
    for (const e of next) {
      ordered.push(e);
      placed.add(e.id);
    }
    left = left.filter((e) => !placed.has(e.id));
  }
  return ordered;
}

/**
 * HR, part 1 (ADR 0046): employees with their checklists, the sign-in links on user profiles,
 * timesheets with a time entry per day, clock punches, time-off policies, requests and the
 * time-off ledger. Pay periods, bonuses and contractor payments arrive with HR part 2, so ledger
 * lines that an approved period posted are seeded without their period link. Seeded documents have
 * no bytes, so no attachment rows are written (ADR 0038).
 */
export async function seedHr(tx: CompanyDb, { fixtures }: DemoCompany): Promise<void> {
  const byName = new Map(fixtures.users.map((user) => [user.name, user.id]));
  const owner = fixtures.users.find((user) => user.roleIds.some((role) => role.endsWith("-owner")));
  const by = userOf(owner?.id);
  const decider = (name: string | null) => userOf(name ? byName.get(name) : null);
  for (const e of managersFirst(fixtures.employees)) {
    await tx
      .insert(employees)
      .values({
        id: seedId(e.id),
        name: e.name,
        title: e.title,
        department: e.department,
        workerType: e.workerType,
        payType: e.payType,
        payRate: e.payRate,
        state: e.state,
        email: e.email,
        phone: e.phone,
        hiredAt: e.hiredAt,
        status: e.status,
        managerId: e.managerId ? seedId(e.managerId) : null,
        externalId: e.externalId ?? null,
        flsaStatus: e.flsaStatus,
        exemptionBasis: e.exemptionBasis,
        salaryHoursPerWeek: e.salaryHoursPerWeek,
        commissionVisible: e.commissionVisible,
        homeLocationId: e.homeLocationId ? seedId(e.homeLocationId) : null,
        birthDate: e.birthDate,
        emergencyContact: e.emergencyContact,
        createdBy: by,
      })
      .onConflictDoNothing();
    const items = [
      ...e.onboarding.map((item, i) => ({ item, list: "onboarding" as const, position: i + 1 })),
      ...e.offboarding.map((item, i) => ({ item, list: "offboarding" as const, position: i + 1 })),
    ];
    if (items.length > 0) {
      await tx
        .insert(employeeChecklistItems)
        .values(
          items.map(({ item, list, position }) => ({
            id: seedId(item.id),
            employeeId: seedId(e.id),
            list,
            position,
            label: item.label,
            doneAt: item.doneAt ? utc(item.doneAt) : null,
            createdBy: by,
          })),
        )
        .onConflictDoNothing();
    }
  }
  for (const user of fixtures.users.filter((person) => person.employeeId)) {
    await tx
      .update(userProfiles)
      .set({ employeeId: seedId(user.employeeId!) })
      .where(and(eq(userProfiles.id, seedId(`profile:${user.id}`)), isNull(userProfiles.employeeId)));
  }
  for (const sheet of fixtures.timesheets) {
    await tx
      .insert(timesheets)
      .values({
        id: seedId(sheet.id),
        employeeId: seedId(sheet.employeeId),
        weekStart: sheet.weekStart,
        status: sheet.status,
        submittedAt: sheet.submittedAt ? utc(sheet.submittedAt) : null,
        decidedById: decider(sheet.decidedBy),
        decidedAt: sheet.decidedAt ? utc(sheet.decidedAt) : null,
        rejectionReason: sheet.rejectionReason,
        source: sheet.source,
        history: sheet.history,
        createdBy: by,
      })
      .onConflictDoNothing();
    await tx
      .insert(timeEntries)
      .values(
        sheet.days.map((hours, i) => ({
          id: seedId(`${sheet.id}:day:${i}`),
          timesheetId: seedId(sheet.id),
          date: addDays(sheet.weekStart, i),
          hours: String(hours),
          createdBy: by,
        })),
      )
      .onConflictDoNothing();
  }
  for (const punch of fixtures.clockEntries) {
    await tx
      .insert(clockEntries)
      .values({
        id: seedId(punch.id),
        employeeId: seedId(punch.employeeId),
        date: punch.date,
        inAt: utc(punch.inAt),
        outAt: punch.outAt ? utc(punch.outAt) : null,
        createdBy: by,
      })
      .onConflictDoNothing();
  }
  for (const policy of fixtures.timeOffPolicies) {
    await tx
      .insert(timeOffPolicies)
      .values({
        id: seedId(policy.id),
        name: policy.name,
        kind: policy.kind,
        paid: policy.paid,
        accrualMethod: policy.accrualMethod,
        accrualRate: policy.accrualRate,
        capHours: policy.capHours || null,
        annualUseLimitHours: policy.annualUseLimitHours || null,
        carryoverHours: policy.carryoverHours || null,
        waitingPeriodDays: policy.waitingPeriodDays,
        allowNegative: policy.allowNegative,
        createdBy: by,
      })
      .onConflictDoNothing();
  }
  for (const request of fixtures.ptoRequests) {
    await tx
      .insert(ptoRequests)
      .values({
        id: seedId(request.id),
        employeeId: seedId(request.employeeId),
        policyId: seedId(request.policyId),
        start: request.start,
        end: request.end,
        hours: request.hours,
        kind: request.kind,
        status: request.status,
        note: request.note,
        decidedById: decider(request.decidedBy),
        decidedAt: request.decidedAt ? utc(request.decidedAt) : null,
        decisionReason: request.decisionReason,
        createdBy: by,
      })
      .onConflictDoNothing();
  }
  for (const entry of fixtures.timeOffEntries) {
    await tx
      .insert(timeOffEntries)
      .values({
        id: seedId(entry.id),
        employeeId: seedId(entry.employeeId),
        policyId: seedId(entry.policyId),
        date: entry.date,
        kind: entry.kind,
        hours: entry.hours,
        note: entry.note,
        requestId: entry.requestId ? seedId(entry.requestId) : null,
        // Pay periods are seeded with HR part 2; their accrual lines keep the hours meanwhile.
        payPeriodId: null,
        createdBy: by,
      })
      .onConflictDoNothing();
  }
}
