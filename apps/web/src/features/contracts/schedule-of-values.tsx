"use client";

import { moneyString, sum, type ContractLine, type ScheduleLine } from "@workspace/shared";
import { Panel } from "@workspace/ui/components/panel";
import { Num } from "@workspace/ui/components/num";
import { ScrollRegion } from "@/components/scroll-region";

const ZERO: Omit<ScheduleLine, "lineId" | "contractId"> = { billed: "0.00", retained: "0.00", remaining: "0.00" };

/**
 * The schedule of values (spec D2; docs/demo-script.md step 8): each line's value and, for people
 * who see billings, what has been billed to date, what is retained and what is left to bill, with
 * a totals row. The figures come from the server's schedule (contracts.md rule 11a).
 */
export function ScheduleOfValues({
  lines,
  schedule,
  showBilling,
  formatDate,
}: {
  lines: readonly ContractLine[];
  schedule: readonly ScheduleLine[];
  showBilling: boolean;
  formatDate: (iso: string) => string;
}) {
  const figuresOf = (line: ContractLine) =>
    schedule.find((s) => s.lineId === line.id) ?? { ...ZERO, remaining: line.scheduledValue };
  const rows = lines.map((line) => ({ line, figures: figuresOf(line) }));
  const total = (pick: (row: (typeof rows)[number]) => string) => moneyString(sum(rows.map(pick)));
  const money = "px-4 py-2 text-right";
  return (
    <Panel title="Schedule of values" bodyClassName="p-0">
      <ScrollRegion label="Schedule of values">
        <table className={`w-full text-sm ${showBilling ? "min-w-[48rem]" : "min-w-[34rem]"}`}>
          <thead className="bg-raised text-muted-foreground text-left text-xs">
            <tr>
              <th className="px-4 py-2 font-medium">Line</th>
              <th className="px-4 py-2 font-medium">Billing</th>
              <th className={`${money} font-medium`}>Value</th>
              {showBilling ? (
                <>
                  <th className={`${money} font-medium`}>Billed to date</th>
                  <th className={`${money} font-medium`}>Retained</th>
                  <th className={`${money} font-medium`}>Remaining to bill</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ line, figures }) => (
              <tr key={line.id} className="border-hairline border-t">
                <td className="px-4 py-2">
                  {line.code} {line.description}
                </td>
                <td className="px-4 py-2">
                  {line.billing === "milestone"
                    ? `Milestone${line.milestoneDueAt ? `, due ${formatDate(line.milestoneDueAt)}` : ""}`
                    : "By progress"}
                </td>
                <td className={money}>
                  <Num kind="money" value={line.scheduledValue} />
                </td>
                {showBilling ? (
                  <>
                    <td className={money}>
                      <Num kind="money" value={figures.billed} />
                    </td>
                    <td className={money}>
                      <Num kind="money" value={figures.retained} />
                    </td>
                    <td className={money}>
                      <Num kind="money" value={figures.remaining} />
                    </td>
                  </>
                ) : null}
              </tr>
            ))}
          </tbody>
          <tfoot className="border-hairline border-t font-medium">
            <tr>
              <th scope="row" colSpan={2} className="px-4 py-2 text-left">
                Total
              </th>
              <td className={money}>
                <Num kind="money" value={total((r) => r.line.scheduledValue)} />
              </td>
              {showBilling ? (
                <>
                  <td className={money}>
                    <Num kind="money" value={total((r) => r.figures.billed)} />
                  </td>
                  <td className={money}>
                    <Num kind="money" value={total((r) => r.figures.retained)} />
                  </td>
                  <td className={money}>
                    <Num kind="money" value={total((r) => r.figures.remaining)} />
                  </td>
                </>
              ) : null}
            </tr>
          </tfoot>
        </table>
      </ScrollRegion>
    </Panel>
  );
}
