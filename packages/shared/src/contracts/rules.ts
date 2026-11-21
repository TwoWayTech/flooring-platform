import { addDays } from "../dates";
import { dec, sum } from "../money";
import type { Contract, ContractLine, ContractStatus, InsuranceCertificate, LienWaiver } from "../types";

/** How each stored status reads, plus the derived Expired (spec D2). */
export const CONTRACT_STATUS_LABELS: Record<ContractStatus | "expired", string> = {
  draft: "Draft",
  sent: "Sent for signature",
  active: "Active",
  completed: "Completed",
  closed: "Closed",
  terminated: "Terminated",
  expired: "Expired",
};

/**
 * The status to show (ADR 0026): a master or an unsigned contract past its end date is Expired. A
 * project past its end date stays Active and is flagged instead, because the work is unfinished.
 */
export function contractDisplayStatus(contract: Contract, today: string): ContractStatus | "expired" {
  const unsigned = contract.status === "draft" || contract.status === "sent";
  const masterRunning = contract.kind === "master" && contract.status === "active";
  return (unsigned || masterRunning) && contract.endsAt < today ? "expired" : contract.status;
}

/** A project still running past its end date, for the flag on the list and page. */
export function pastEndDate(contract: Contract, today: string): boolean {
  return contract.kind === "project" && contract.status === "active" && contract.endsAt < today;
}

/** Why a draft cannot go for signature, or null: a project's lines must add up to its value (ADR 0026). */
export function draftProblem(contract: Contract, lines: readonly ContractLine[]): string | null {
  if (!contract.title.trim()) return "Give the contract a title.";
  if (!contract.customerId && !contract.supplierId) return "Choose the other company.";
  if (contract.endsAt < contract.startsAt) return "The end date must be after the start date.";
  if (contract.kind === "master") return null;
  const own = lines.filter((l) => l.contractId === contract.id);
  if (own.length === 0) return "Add at least one line to the schedule of values.";
  if (!sum(own.map((l) => l.scheduledValue)).eq(contract.originalValue))
    return "The lines must add up to the contract value.";
  return null;
}

/** Example state limits on private retainage (ADR 0026): confirm with counsel. A warning, never a block. */
const RETAINAGE_LIMITS: Record<string, { pct: string; fromValue: string; note: string }> = {
  CA: { pct: "5", fromValue: "0", note: "California limits private retainage to 5% on contracts from 2026." },
  CO: { pct: "5", fromValue: "150000", note: "Colorado limits retainage to 5% on contracts of $150,000 or more." },
};

/** A warning when retainage is above the state's limit, or null. */
export function retainageWarning(state: string, retainagePct: string, value: string): string | null {
  const limit = RETAINAGE_LIMITS[state];
  if (!limit || dec(value).lt(limit.fromValue) || dec(retainagePct).lte(limit.pct)) return null;
  return limit.note;
}

/** Why a contract cannot close, or null (ADR 0026): nothing held, nothing owed, and a final waiver on file. */
export function closeProblem(input: { held: string; balance: string; hasFinalWaiver: boolean }): string | null {
  if (dec(input.held).gt(0)) return "Release the retainage before closing.";
  if (dec(input.balance).gt(0)) return "Its invoices or bills still have a balance.";
  if (!input.hasFinalWaiver) return "No final lien waiver is on file.";
  return null;
}

/** Valid, expiring within 30 days, or expired, from the earliest coverage (ADR 0026). */
export function insuranceStatus(
  cert: Pick<InsuranceCertificate, "coverages">,
  today: string,
): "valid" | "expiring" | "expired" {
  const earliest = [...cert.coverages].map((c) => c.expiresOn).sort()[0];
  if (!earliest || earliest < today) return "expired";
  return earliest <= addDays(today, 30) ? "expiring" : "valid";
}

/** What a recorded signature says, in the dialog and on the signed PDF: no signing provider yet (contracts.md step 3). */
export const TYPED_SIGNATURE_NOTE = "Recorded as a typed signature; a signing provider is not connected yet.";

/**
 * The warning shown when a subcontract is signed with no insurance certificate on file, or null
 * (contracts.md step 3, owner 2026-11-21). It only warns: signing is never blocked by it.
 */
export function signatureWarning(
  contract: Pick<Contract, "direction">,
  certificate: Pick<InsuranceCertificate, "coverages"> | null,
): string | null {
  return contract.direction === "subcontractor" && !certificate ? "No insurance certificate on file" : null;
}

/** Why a waiver cannot be recorded, or null: an unconditional waiver must follow a confirmed payment (ADR 0026). */
export function waiverProblem(waiver: Pick<LienWaiver, "type" | "amount">, paymentConfirmed: boolean): string | null {
  if (!dec(waiver.amount || 0).gt(0)) return "Enter the waiver amount.";
  if (waiver.type.startsWith("unconditional") && !paymentConfirmed) {
    return "An unconditional waiver needs a confirmed payment.";
  }
  return null;
}

/** A dated reminder from a contract (spec D2). */
export interface ContractReminder {
  key: string;
  contractId: string;
  what: string;
  date: string;
}

const CONTRACT_NOTICE_DAYS = [90, 60, 30];
const INSURANCE_NOTICE_DAYS = [60, 30, 7];
const MILESTONE_NOTICE_DAYS = [14, 3];

/** The latest notice step reached for a date, so a reminder fires once per step. */
function stepReached(date: string, today: string, days: readonly number[]): number | null {
  const reached = days.filter((d) => addDays(date, -d) <= today && date >= today);
  return reached.length ? Math.min(...reached) : null;
}

/** Reminders due today (ADR 0026): renewal notice, expiring insurance, milestones. */
export function contractReminders(
  contracts: readonly Contract[],
  lines: readonly ContractLine[],
  certificates: readonly InsuranceCertificate[],
  today: string,
): ContractReminder[] {
  const out: ContractReminder[] = [];
  for (const c of contracts.filter((x) => x.status === "active")) {
    const deadline = addDays(c.endsAt, -c.renewal.noticeDays);
    const step = stepReached(deadline, today, CONTRACT_NOTICE_DAYS);
    if (step !== null)
      out.push({ key: `${c.id}-end-${step}`, contractId: c.id, what: "Contract end notice is due", date: deadline });
    for (const line of lines.filter((l) => l.contractId === c.id && l.milestoneDueAt)) {
      const due = stepReached(line.milestoneDueAt!, today, MILESTONE_NOTICE_DAYS);
      if (due !== null)
        out.push({
          key: `${line.id}-ms-${due}`,
          contractId: c.id,
          what: `Milestone ${line.code} is due`,
          date: line.milestoneDueAt!,
        });
    }
  }
  for (const cert of certificates) {
    for (const coverage of cert.coverages) {
      const step = stepReached(coverage.expiresOn, today, INSURANCE_NOTICE_DAYS);
      if (step !== null)
        out.push({
          key: `${cert.id}-${coverage.type}-${step}`,
          contractId: cert.contractId,
          what: `Insurance (${coverage.type.replace("_", " ")}) expires`,
          date: coverage.expiresOn,
        });
    }
  }
  return out;
}

/** Reporting threshold per payment year (ADR 0026); later years to be filled in from the IRS. */
const FORM_1099_THRESHOLDS: Record<string, string> = { "2025": "600", "2026": "2000" };

/** The 1099-NEC threshold for a year, using the latest known one for later years. */
export function form1099Threshold(year: string): string {
  const known = Object.keys(FORM_1099_THRESHOLDS).sort();
  return FORM_1099_THRESHOLDS[year] ?? FORM_1099_THRESHOLDS[known.at(-1)!]!;
}
