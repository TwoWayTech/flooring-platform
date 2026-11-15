import {
  companyPhase,
  isLifecycleStatus,
  type Company,
  type CompanyPhase,
  type LifecycleFacts,
  type LifecycleStatus,
} from "@workspace/shared";
import { DEMO_PHASE, demoSubscription } from "./platform-console";

/*
 * A company's status in the demo console (docs/specs/platform-admin.md, part 2, "Demo mode"). The
 * console keeps its own status per company; the demo company's own side has no life cycle, so it
 * keeps working, stays on the sign-in list and shows no notice (ADR 0054).
 */

/** Where the demo keeps the console's status per company in local storage (cleared by Reset demo). */
export const DEMO_STATUS_KEY = "platform-status";

/** The console's status of one demo company and when it last changed (an ISO moment). */
export interface DemoStatusEntry {
  status: LifecycleStatus;
  statusChangedAt: string;
}

/** What the demo keeps under `platform-status`, by company id. */
export type DemoStatusStore = Record<string, DemoStatusEntry>;

/** Where a demo company stands in the console: its status, since when, and its phase. */
export interface DemoConsoleStanding {
  status: LifecycleStatus;
  statusChangedAt: string;
  phase: CompanyPhase;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEntry(value: unknown): value is DemoStatusEntry {
  if (!isRecord(value)) return false;
  const { status, statusChangedAt } = value;
  return (
    isLifecycleStatus(status) && typeof statusChangedAt === "string" && Number.isFinite(Date.parse(statusChangedAt))
  );
}

/** What is stored under `platform-status`, read defensively: an entry that doesn't fit is dropped. */
export function demoStatusStore(stored: unknown): DemoStatusStore {
  if (!isRecord(stored)) return {};
  return Object.fromEntries(
    Object.entries(stored).filter((pair): pair is [string, DemoStatusEntry] => isEntry(pair[1])),
  );
}

/**
 * The life-cycle facts of a demo company, as the console's status rule reads them: the stored
 * console status (or the fixture's, since its creation), and its one stand-in subscription row
 * (`demoSubscription`, price "0.00", never deleted). The stand-in row counts as paid, as the API's
 * seeded `active` rows at 0.00 do.
 */
export function demoStatusFacts(company: Company, stored: DemoStatusStore, today: string): LifecycleFacts {
  const entry = Object.hasOwn(stored, company.id) ? stored[company.id] : undefined;
  const row = demoSubscription(company, today);
  return {
    status: entry?.status ?? company.status,
    statusChangedAt: new Date(entry?.statusChangedAt ?? company.createdAt),
    subscriptions: [
      { status: row.status, currentPeriodEnd: new Date(row.currentPeriodEnd), price: row.price, deleted: false },
    ],
  };
}

/**
 * Where a demo company stands in the console's list and detail: an untouched company keeps the
 * demo's full use; once the console changed its status, the phase is the one `companyPhase` gives.
 */
export function demoConsoleStanding(
  company: Company,
  stored: DemoStatusStore,
  today: string,
  now: Date,
): DemoConsoleStanding {
  if (!Object.hasOwn(stored, company.id)) {
    return { status: company.status, statusChangedAt: company.createdAt, phase: DEMO_PHASE };
  }
  const facts = demoStatusFacts(company, stored, today);
  return {
    status: facts.status,
    statusChangedAt: facts.statusChangedAt.toISOString(),
    phase: companyPhase(facts, now),
  };
}
