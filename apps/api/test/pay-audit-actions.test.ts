import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PAY_SENSITIVE_AUDIT_ACTIONS } from "@workspace/shared";
import { describe, expect, it } from "vitest";

const MODULES = join(__dirname, "../src/modules");
const HR = join(MODULES, "hr");

/** The text of one method of a class, from its declaration to the next member's JSDoc or declaration. */
function methodText(text: string, name: string): string {
  const start = text.search(new RegExp(`\\n  (?:private )?(?:async )?${name}\\(`));
  expect(start, `method ${name}`).toBeGreaterThan(-1);
  const next = text.slice(start + 1).search(/\n {2}(?:\/\*\*|(?:private )?(?:async )?\w+\()/);
  return next === -1 ? text.slice(start) : text.slice(start, start + 1 + next);
}

/**
 * The pay sources whose audit entries may carry plan terms or reasons: the commission services, pay
 * periods, bonuses, and the one writer of the commission split in sales (security review of PR #30).
 */
const SOURCES = [
  ...readdirSync(HR)
    .filter((file) => /^(commission|pay-periods|bonuses)/.test(file) && file.endsWith(".ts"))
    .map((file) => ({ file, text: readFileSync(join(HR, file), "utf8") })),
  {
    file: "sales/invoices.service.ts#setCommissionSplit",
    text: methodText(readFileSync(join(MODULES, "sales/invoices.service.ts"), "utf8"), "setCommissionSplit"),
  },
];

/**
 * Entries that carry a free-text reason the owner's decision does not cover (it covers plan terms and
 * commission adjustment reasons only), so the reason checks below let exactly these through.
 * owner question: bonus/exclusion reasons (STATUS)
 */
const REASON_EXEMPT: ReadonlySet<string> = new Set([
  "Left out of pay period",
  "Brought back into pay period",
  "Added bonus",
  "Voided bonus",
]);

/**
 * Pay audit actions that carry neither plan terms nor a commission adjustment or decision reason
 * (ADR 0048 "No amounts in the log"), so every audit viewer reads them. A new action must be put here
 * or in PAY_SENSITIVE_AUDIT_ACTIONS, so nobody adds one without deciding who may read it.
 */
const NOT_PAY_SENSITIVE = new Set([
  "Approved commission statement", // status and month only
  "Assigned commission plan", // plan name, dates and whether there is an own target, never the figure
  "Published new version of commission plan", // version numbers, start day and how many moved
  "Moved commission assignment to new plan version", // plan ids and dates
  "Cleared commission plan signature after plan edit", // signed true or false
  "Changed commission split", // the split's people and shares, not plan terms
  "Opened pay period",
  "Approved pay period",
  "Reopened pay period",
  "Exported pay period",
  "Added commission statement to pay period",
  "Paid commission statement",
  "Released commission statement from pay period",
  ...REASON_EXEMPT,
]);

/** Helpers that pass their caller's action through; their callers are checked instead. */
const PASS_THROUGH_HELPERS = new Set(["auditPlan"]);

/** Helpers that write one fixed action; each call site is checked as that action. */
const FIXED_ACTION_HELPERS: Readonly<Record<string, string>> = {
  auditMove: "Moved commission assignment to new plan version",
};

/** What in an entry's text would carry plan terms or a reason. */
const TERMS_OR_REASON = /planValues|baseRatePct|tiers|monthlyTarget|overridePct|draw|clawbackDays|\breason\b/;

/**
 * An entry's text with the uses known to carry no figure taken out: whether a person has their own
 * target (`ownTarget: x.monthlyTargetOverride !== null`), a true or false, never the amount.
 */
const withoutKnownBooleans = (body: string) => body.replace(/\w+\.monthlyTargetOverride !== null/g, "");

/**
 * The action names in an expression, such as `a === "applied" ? "Accepted X" : "Waived X"`: its string
 * literals that read as an action (a capital letter, then words), not the values it compares.
 */
const literals = (expression: string) =>
  [...expression.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).filter((text) => /^[A-Z][a-z]+ /.test(text));

/** The method an index of a source falls in, by the nearest member declaration above it. */
function enclosingMethod(text: string, index: number): string | null {
  const above = [...text.slice(0, index).matchAll(/\n {2}(?:private )?(?:async )?(\w+)\(/g)];
  return above.at(-1)?.[1] ?? null;
}

interface AuditCall {
  file: string;
  line: number;
  actions: string[];
  body: string;
}

/**
 * Each audit call in a source with the actions it can write: `auditHr(`, `.record(` and any
 * `this.audit…(` helper call. A call whose action is a variable is skipped only inside a named
 * pass-through helper; anywhere else it is returned with no actions, which the first test fails.
 */
function auditCalls(file: string, text: string): AuditCall[] {
  const calls: AuditCall[] = [];
  for (const match of text.matchAll(/auditHr\(|\.record\(|this\.(audit\w+)\(/g)) {
    const start = match.index;
    const end = text.indexOf(");", start);
    const body = text.slice(start, end === -1 ? undefined : end);
    const line = text.slice(0, start).split("\n").length;
    const helper = match[1];
    let actions: string[];
    if (helper && FIXED_ACTION_HELPERS[helper]) {
      actions = [FIXED_ACTION_HELPERS[helper]];
    } else if (helper) {
      actions = literals(body);
    } else {
      actions = literals(/action:\s*([^\n]+)/.exec(body)?.[1] ?? "");
      const method = enclosingMethod(text, start);
      if (actions.length === 0 && method && PASS_THROUGH_HELPERS.has(method)) continue;
    }
    calls.push({ file, line, actions, body });
  }
  return calls;
}

describe("pay-sensitive audit actions (owner decision 2026-11-14; ADR 0048 'Audit visibility')", () => {
  const calls = SOURCES.flatMap((source) => auditCalls(source.file, source.text));
  const where = (call: AuditCall) => `${call.file}:${call.line}`;

  it("finds the pay audit calls, each with a written action", () => {
    expect(calls.length).toBeGreaterThanOrEqual(20);
    for (const call of calls) expect(call.actions, `${where(call)} has no literal action`).not.toHaveLength(0);
    expect(calls.some((call) => call.actions.includes("Changed commission split"))).toBe(true);
    // Each fixed-action helper really writes the action its call sites are checked as.
    for (const [helper, action] of Object.entries(FIXED_ACTION_HELPERS)) {
      const source = SOURCES.find((s) => s.text.includes(`private ${helper}(`));
      expect(source && methodText(source.text, helper), helper).toContain(`"${action}"`);
    }
  });

  it("lists every plan-terms entry and every commission entry that carries a reason", () => {
    for (const call of calls) {
      const viaPlan = call.body.startsWith("this.auditPlan(");
      if (!viaPlan && !/\breason\b/.test(call.body)) continue;
      for (const action of call.actions) {
        if (REASON_EXEMPT.has(action)) continue;
        expect(PAY_SENSITIVE_AUDIT_ACTIONS.has(action), `${where(call)}: "${action}"`).toBe(true);
      }
    }
  });

  it("has every pay audit action decided: pay-sensitive or not", () => {
    for (const call of calls) {
      for (const action of call.actions) {
        const decided = PAY_SENSITIVE_AUDIT_ACTIONS.has(action) || NOT_PAY_SENSITIVE.has(action);
        expect(decided, `${where(call)}: "${action}" is in neither list`).toBe(true);
      }
    }
  });

  it("finds no plan terms or reason in an entry left readable to every audit viewer", () => {
    for (const call of calls) {
      const open = call.actions.filter((a) => NOT_PAY_SENSITIVE.has(a) && !REASON_EXEMPT.has(a));
      if (open.length === 0) continue;
      expect(withoutKnownBooleans(call.body), `${where(call)}: ${open.join(", ")}`).not.toMatch(TERMS_OR_REASON);
    }
  });
});
