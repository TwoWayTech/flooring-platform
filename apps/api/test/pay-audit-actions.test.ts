import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PAY_SENSITIVE_AUDIT_ACTIONS } from "@workspace/shared";
import { describe, expect, it } from "vitest";

const HR = join(__dirname, "../src/modules/hr");

/** The commission services, whose audit entries may carry plan terms or reasons. */
const SOURCES = readdirSync(HR)
  .filter((file) => file.startsWith("commission") && file.endsWith(".ts"))
  .map((file) => ({ file, text: readFileSync(join(HR, file), "utf8") }));

/**
 * Commission audit actions that carry neither plan terms nor a reason (ADR 0048 "No amounts in the
 * log"), so every audit viewer reads them. A new action must be put here or in
 * PAY_SENSITIVE_AUDIT_ACTIONS, so nobody adds one without deciding who may read it.
 */
const NOT_PAY_SENSITIVE = new Set([
  "Approved commission statement", // status and month only
  "Assigned commission plan", // plan name, dates and whether there is an own target, never the figure
  "Published new version of commission plan", // version numbers, start day and how many moved
  "Moved commission assignment to new plan version", // plan ids and dates
  "Cleared commission plan signature after plan edit", // signed true or false
]);

/**
 * The action names in an expression, such as `a === "applied" ? "Accepted X" : "Waived X"`: its string
 * literals that read as an action (a capital letter, then words), not the values it compares.
 */
const literals = (expression: string) =>
  [...expression.matchAll(/"([^"]+)"/g)].map((m) => m[1]!).filter((text) => /^[A-Z][a-z]+ /.test(text));

/** Each audit call in a source: the actions it can write and the text of its entry. */
function auditCalls(text: string): { actions: string[]; body: string; plan: boolean }[] {
  const calls: { actions: string[]; body: string; plan: boolean }[] = [];
  for (const match of text.matchAll(/auditHr\(|\.record\(|this\.auditPlan\(/g)) {
    const start = match.index;
    const end = text.indexOf(");", start);
    const body = text.slice(start, end === -1 ? undefined : end);
    const plan = match[0] === "this.auditPlan(";
    const actions = plan ? literals(body) : literals(/action:\s*([^\n]+)/.exec(body)?.[1] ?? "");
    // A helper that passes its caller's action through (`auditPlan`) is checked at its callers.
    if (actions.length === 0 && /\baction,/.test(body)) continue;
    calls.push({ actions, body, plan });
  }
  return calls;
}

describe("pay-sensitive audit actions (owner decision 2026-11-14; ADR 0048 'Audit visibility')", () => {
  const calls = SOURCES.flatMap((source) => auditCalls(source.text).map((call) => ({ ...call, file: source.file })));

  it("finds the commission audit calls", () => {
    expect(calls.length).toBeGreaterThanOrEqual(8);
    expect(calls.every((call) => call.actions.length > 0)).toBe(true);
  });

  it("lists every plan-terms entry and every entry that carries a reason", () => {
    for (const call of calls) {
      if (!call.plan && !/\breason\b/.test(call.body)) continue;
      for (const action of call.actions) {
        expect(PAY_SENSITIVE_AUDIT_ACTIONS.has(action), `${call.file}: "${action}"`).toBe(true);
      }
    }
  });

  it("has every commission audit action decided: pay-sensitive or not", () => {
    for (const action of calls.flatMap((call) => call.actions)) {
      const decided = PAY_SENSITIVE_AUDIT_ACTIONS.has(action) || NOT_PAY_SENSITIVE.has(action);
      expect(decided, `"${action}" is in neither list`).toBe(true);
    }
  });
});
