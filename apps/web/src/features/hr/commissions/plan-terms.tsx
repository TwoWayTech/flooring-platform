import { dec, type CommissionPlan } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";

/**
 * A commission plan's terms in one sentence, as the Plans tab shows them (commissions.md
 * "CommissionPlan"): the base rate and basis, the monthly target, each tier, the clawback window,
 * a manager override when the plan pays one, and a draw when it has one. The override is read by
 * value: the API sends rates through decimal.js and the demo keeps what was typed, such as "0.0".
 */
export function PlanTerms({ plan }: { plan: CommissionPlan }) {
  return (
    <p className="text-sm">
      <Num kind="percent" value={plan.baseRatePct} /> of{" "}
      {plan.basis === "paid_revenue" ? "paid revenue" : "gross margin"} up to a monthly target of{" "}
      <Num kind="money" value={plan.monthlyTarget} />
      {plan.tiers.map((t) => (
        <span key={t.fromPctOfTarget}>
          , then <Num kind="percent" value={t.ratePct} /> from <Num kind="percent" value={t.fromPctOfTarget} /> of
          target
        </span>
      ))}
      . Clawback window {plan.clawbackDays} days.
      {dec(plan.overridePct).gt(0) ? (
        <>
          {" "}
          Manager override <Num kind="percent" value={plan.overridePct} />.
        </>
      ) : null}
      {plan.draw.kind !== "none" ? (
        <>
          {" "}
          {plan.draw.kind === "recoverable" ? "Recoverable" : "Guaranteed"} draw of{" "}
          <Num kind="money" value={plan.draw.monthlyAmount} /> a month.
        </>
      ) : null}
    </p>
  );
}
