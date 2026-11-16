import { SENSITIVE_FIELDS, type PermissionKey } from "@workspace/shared";
import type { FieldKeys } from "../../src/core/access/sensitive-fields";
import type { Reviewed } from "./route-lists";
import { camelName, jsonNodes, MUST_STRIP, own, type JsonNode } from "./strippable";

/**
 * MUST_STRIP names no answer shows Summit's Owner on any list read (PM-7), so PM-7 can't prove they
 * are stripped; each with why. Pinned, so a name that starts or stops showing is reviewed.
 */
export const MUST_STRIP_NOT_EXERCISED: Reviewed = {
  averageCost:
    "No answer has this field: the API computes the average cost (shared averageCost) and sends it as cost or unitCost.",
  hourlyRate: "No type or answer uses this name today; reserved.",
  jobCost: "Installation job costing, and the installation module has no routes yet (finding F-e).",
  jobMargin: "Installation job costing, and the installation module has no routes yet (finding F-e).",
  jobMarginPct: "Reserved for installation job costing, which has no routes yet (finding F-e).",
  laborCost: "A job's labor cost (installation), and the installation module has no routes yet (finding F-e).",
  landedCost: "No type or answer uses this name today; reserved.",
  marginPct:
    "Only the demo dashboard and installation job costing use it; the API's reports send grossMarginPct and margin.",
  productCost: "The name of the sensitive key group (SENSITIVE.productCost), not a field any answer has.",
  salary: 'On the API only a payType value ("salary"); pay amounts go as salaryAmount and payRate.',
};

/** The keys a field needs by the reviewed list and by the shared map, by its name as sent or in camelCase. */
function keysFor(field: string): PermissionKey[] {
  const names = [field, camelName(field)];
  const found = names.flatMap((name) => [own(MUST_STRIP, name), own(SENSITIVE_FIELDS, name)]);
  return [...new Set(found.filter((key): key is PermissionKey => key !== undefined))];
}

/** A sensitive field a viewer should not have received: its name and the first place it was found. */
export interface Leak {
  field: string;
  path: string;
}

/**
 * The sensitive fields a viewer holding `held` received, at any depth (CLAUDE.md rule 5). A field
 * is judged by the route's own `@SensitiveFieldKeys` where it has one for that name (any one key
 * reveals it, as the interceptor reads it), and otherwise by MUST_STRIP and SENSITIVE_FIELDS
 * together: every key either names must be held. One entry per field name, at its first place.
 */
export function leaks(body: unknown, held: ReadonlySet<PermissionKey>, routeKeys?: FieldKeys): Leak[] {
  const found = new Map<string, Leak>();
  for (const node of jsonNodes(body)) {
    if (node.item || node.field === undefined || found.has(node.field)) continue;
    const ownKeys = own(routeKeys, node.field);
    const visible = ownKeys ? ownKeys.some((key) => held.has(key)) : keysFor(node.field).every((key) => held.has(key));
    if (!visible) found.set(node.field, { field: node.field, path: node.path });
  }
  return [...found.values()];
}

/** A decimal string as rule 6 sends money, quantities and rates: digits, an optional sign and fraction. */
const DECIMAL = /^-?\d+(\.\d+)?$/;

/**
 * Fields that carry money, quantities, hours, percentages or rates (CLAUDE.md rule 6): wherever one
 * appears its value must be a decimal string, or null where nothing is set. Reviewed by hand from
 * every field PM-7 met on Summit holding a decimal-looking string. Left out on purpose: card and
 * check numbers, zip codes and product attributes (text that happens to be digits), `commission`
 * (money on GET /commissions, a yes/no flag on GET /me/portal), and the time-off policy's
 * `capHours` and `annualUseLimitHours`, which send "" for "no limit".
 */
export const MONEY_KEYS: ReadonlySet<string> = new Set<string>([
  "accrualRate",
  "adjustment",
  "allocatedEarnings",
  "amount",
  "amountDelta",
  "base",
  "baseRate",
  "baseRatePct",
  "carryIn",
  "carryOut",
  "cogs",
  "collected",
  "commissionPay",
  "completedToDate",
  "cost",
  "costPerSqFt",
  "credit",
  "creditLimit",
  "damaged",
  "days",
  "debit",
  "depositPct",
  "discretionaryBonus",
  "doubleTimeHours",
  "draw",
  "earned",
  "earnedThisYear",
  "estimatedCost",
  "expenses",
  "floorAreaSqFt",
  "fromPctOfTarget",
  "gross",
  "grossMargin",
  "grossMarginPct",
  "grossPay",
  "hours",
  "hoursWorked",
  "lengthFt",
  "margin",
  "monthlyAmount",
  "monthlyTarget",
  "net",
  "netIncome",
  "nondiscretionaryBonus",
  "originalLengthFt",
  "originalValue",
  "override",
  "overridePct",
  "overtimeHours",
  "overtimePremium",
  "overtimeTrueUp",
  "paidLeaveHours",
  "paidLeavePay",
  "payRate",
  "payable",
  "pct",
  "pending",
  "price",
  "quantity",
  "ratePct",
  "received",
  "regularRate",
  "released",
  "remainingLengthFt",
  "reorderPoint",
  "retainagePct",
  "retainageReleased",
  "retainageWithheld",
  "revenue",
  "reversal",
  "salaryAmount",
  "salaryDeduction",
  "scheduledValue",
  "shortBy",
  "sqFtPerCarton",
  "storedBalance",
  "storedRetainagePct",
  "straightTimePay",
  "subtotal",
  "tax",
  "total",
  "unitCost",
  "unitPrice",
  "unpaidLeaveHours",
  "wastePct",
  "widthFt",
  "withheld",
]);

/**
 * Fields whose value is a JSON number because it is a whole count, each with what it counts. MI-DEC
 * checks every value is an integer.
 */
export const INTEGER_KEYS: Reviewed = {
  branchLimit: "GET /billing: how many branches the plan allows.",
  clawbackDays: "A commission plan's clawback window in whole days.",
  create: "An import's count of rows it creates (ADR 0057): the dry run's, the batch's and its undo's `counts`.",
  dayOfMonth: "A recurring expense's day of the month, 1 to 31.",
  displaySamples: "A location's count of display samples on the floor (plan A-1), never stock.",
  durationMin: "A meeting's length in whole minutes, 15 to 1440.",
  error: "An import's count of rows refused for problems (ADR 0057), beside `create`, `update` and `skip`.",
  line: "An import row's line in its file, the header being line 1 (ADR 0057).",
  noticeDays: "A contract renewal's notice period in whole days.",
  number: "A contract billing's sequence within its contract (1, 2, …); other documents' numbers are text.",
  passkeys: "GET /auth/context: how many passkeys the person has registered.",
  recordCount: "A Business report row cut at 200 drill records: how many records it holds (ADR 0055).",
  reminderMin: "A meeting reminder's lead time in whole minutes.",
  rescheduleSequence: "The iCalendar SEQUENCE a meeting's last move was sent with.",
  respondedSequence: "The iCalendar SEQUENCE a guest last answered.",
  salaryHoursPerWeek:
    "The whole hours a salary covers (40, or California's; ADR 0024); the API accepts integers 1 to 60 only.",
  sequence: "A meeting's iCalendar SEQUENCE.",
  size: "An attached file's size in bytes (proof of payment, a bill's file, a receipt).",
  skip: "An import's count of rows it leaves as they are (ADR 0057), beside `create`, `update` and `error`.",
  update: "An import's count of rows it updates (ADR 0057), beside `create`, `skip` and `error`.",
  userLimit: "GET /billing: how many users the plan allows.",
  version: "A version number: a commission plan's, a contract signature's or a tax rule's.",
  waitingPeriodDays: "A time-off policy's waiting period in whole days.",
  weekStartDay: "My portal: the first day of the company's workweek, 0 to 6.",
};

/** Why a JSON number that is not a whole count is listed: outside rule 6, or a rule-6 finding to follow up. */
export type NumberKeyKind = "not money or a quantity" | "finding F-k";

/**
 * JSON numbers that are not whole counts. Coordinates are outside rule 6. The rest are quantities
 * rule 6 wants as decimal strings: each is finding F-k, with a proposed STATUS line, listed so it is
 * followed up rather than hidden (S-12).
 */
export const OTHER_NUMBER_KEYS: Readonly<Record<string, readonly [NumberKeyKind, string]>> = {
  lat: ["not money or a quantity", "A customer address's map latitude in degrees."],
  lengthFt: [
    "finding F-k",
    "A quote room's length in ft (feeds the room's area) is a JSON number; a roll cut's lengthFt is a decimal string.",
  ],
  lng: ["not money or a quantity", "A customer address's map longitude in degrees."],
  reorderPoint: [
    "finding F-k",
    "A product's reorder point in sq ft: stored numeric(14,3) but sent through asNumber, so Summit sends 692.85.",
  ],
  widthFt: [
    "finding F-k",
    "A product's, a roll's and a quote room's width in ft are JSON numbers (asNumber, Number); they feed sq ft.",
  ],
  x: ["not money or a quantity", "A quote room's position on the drawing canvas."],
  y: ["not money or a quantity", "A quote room's position on the drawing canvas."],
};

/** A rule-6 problem in a body: the field, what is wrong, and the first place it was seen. */
export interface DecimalProblem {
  field: string;
  problem: string;
  path: string;
}

/**
 * Where a body breaks CLAUDE.md rule 6 (MI-DEC): a JSON number under a field that is neither a
 * reviewed whole count (INTEGER_KEYS, which must then be an integer) nor listed in
 * OTHER_NUMBER_KEYS, or a MONEY_KEYS field that is not a decimal string or null. One entry per
 * field and problem, at its first place.
 */
export function decimalProblems(body: unknown): DecimalProblem[] {
  const found = new Map<string, DecimalProblem>();
  const note = (node: JsonNode, problem: string) => {
    const field = node.field ?? "(root)";
    const key = `${field} ${problem}`;
    if (!found.has(key)) found.set(key, { field, problem, path: node.path });
  };
  for (const node of jsonNodes(body)) {
    const field = node.field ?? "";
    if (typeof node.value === "number") {
      if (own(INTEGER_KEYS, field) !== undefined) {
        if (!Number.isInteger(node.value)) note(node, "is a reviewed whole count but not an integer");
      } else if (own(OTHER_NUMBER_KEYS, field) === undefined) {
        note(node, "is a JSON number");
      }
    } else if (MONEY_KEYS.has(field) && node.value !== null && typeof node.value !== "object") {
      // Arrays and objects are containers (a plan's draw, a report section's total row): their own
      // fields are checked where the walk meets them.
      if (typeof node.value !== "string" || !DECIMAL.test(node.value)) note(node, "is not a decimal string");
    }
  }
  return [...found.values()];
}
