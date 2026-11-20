"use client";

import { useId, useState } from "react";
import { CircleCheck, Download, TriangleAlert } from "lucide-react";
import {
  REPORT_CATALOG,
  REPORT_YEARS,
  reportDayProblem,
  type ReportOptions,
  type TrialBalance,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { Switch } from "@workspace/ui/components/switch";
import { cn } from "@workspace/ui/lib/utils";
import { downloadText } from "@/components/data-table/csv";
import { ScrollRegion } from "@/components/scroll-region";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { shownAnswer, type KeyedAnswer } from "./report-answer";
import { ReportFallback } from "./report-fallback";
import { balanceSide, outOfBalanceBy, trialBalanceCsv, trialBalanceGroups } from "./trial-balance-model";

const KEY = "trial-balance";
const TITLE = REPORT_CATALOG[KEY].label;

/** Debits, credits and whether they agree: the proof a trial balance exists to give. */
function Proof({ tb }: { tb: TrialBalance }) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
      {tb.balanced ? (
        <StatusPill tone="success" icon={CircleCheck} label="Balanced" />
      ) : (
        <StatusPill tone="danger" icon={TriangleAlert} label="Out of balance" />
      )}
      <span>
        <span className="text-muted-foreground">Debits </span>
        <Num kind="money" value={tb.debit} className="font-medium" />
      </span>
      <span>
        <span className="text-muted-foreground">Credits </span>
        <Num kind="money" value={tb.credit} className="font-medium" />
      </span>
      {tb.balanced ? null : (
        <span className="text-danger-ink">
          Debits and credits differ by <Num kind="money" value={outOfBalanceBy(tb)} />. Tell your accountant.
        </span>
      )}
    </div>
  );
}

function Balance({ value }: { value: string }) {
  const { side, amount } = balanceSide(value);
  return (
    <>
      <Num kind="money" value={amount} />
      <span className="text-muted-foreground ml-1 inline-block w-5 text-left text-xs">
        {side ? <abbr title={side === "Dr" ? "Debit balance" : "Credit balance"}>{side}</abbr> : null}
      </span>
    </>
  );
}

function TrialBalanceTable({ tb, showEmpty, busy }: { tb: TrialBalance; showEmpty: boolean; busy: boolean }) {
  const groups = trialBalanceGroups(tb, showEmpty);
  const cell = "h-9 px-3 whitespace-nowrap";
  return (
    <ScrollRegion
      label={`${TITLE} table`}
      busy={busy}
      className={cn("border-hairline rounded-md border", busy && "opacity-60")}
    >
      <table className="w-full min-w-[34rem] text-sm tabular-nums">
        <thead className="bg-raised text-muted-foreground text-xs">
          <tr>
            <th scope="col" className={cn(cell, "w-20 text-left font-medium")}>
              Code
            </th>
            <th scope="col" className={cn(cell, "text-left font-medium")}>
              Account
            </th>
            <th scope="col" className={cn(cell, "text-right font-medium")}>
              Debits
            </th>
            <th scope="col" className={cn(cell, "text-right font-medium")}>
              Credits
            </th>
            <th scope="col" className={cn(cell, "text-right font-medium")}>
              Balance
            </th>
          </tr>
        </thead>
        {groups.length === 0 ? (
          <tbody>
            <tr>
              <td colSpan={5} className="text-muted-foreground h-16 px-3">
                Nothing has been recorded in the books through this day. Choose a later day.
              </td>
            </tr>
          </tbody>
        ) : null}
        {groups.map((group) => (
          <tbody key={group.type}>
            <tr className="border-hairline border-t">
              <th scope="rowgroup" colSpan={5} className="h-8 px-3 pt-3 text-left text-xs font-semibold">
                {group.label}
              </th>
            </tr>
            {group.rows.map((row) => (
              <tr key={row.code} className="border-hairline border-t">
                <td className={cn(cell, "text-muted-foreground")}>{row.code}</td>
                <th scope="row" className={cn(cell, "text-left font-normal")}>
                  {row.name}
                </th>
                <td className={cn(cell, "text-right")}>
                  <Num kind="money" value={row.debit} />
                </td>
                <td className={cn(cell, "text-right")}>
                  <Num kind="money" value={row.credit} />
                </td>
                <td className={cn(cell, "text-right")}>
                  <Balance value={row.balance} />
                </td>
              </tr>
            ))}
          </tbody>
        ))}
        <tfoot>
          <tr className="border-hairline border-t-2 font-semibold">
            <td className={cell} />
            <th scope="row" className={cn(cell, "text-left")}>
              Total
            </th>
            <td className={cn(cell, "text-right")}>
              <Num kind="money" value={tb.debit} />
            </td>
            <td className={cn(cell, "text-right")}>
              <Num kind="money" value={tb.credit} />
            </td>
            <td className={cell} />
          </tr>
        </tfoot>
      </table>
    </ScrollRegion>
  );
}

/**
 * The trial balance (ADR 0055 "Trial balance"; ADR 0039): every account's debits, credits and
 * balance from the company's journal through the end of a day, grouped by kind, with whether the
 * books balance. Read only, and only in api mode: the hub lists it only when the server would
 * answer, which needs cost, contract and pay sight as well as company-wide financial reports.
 * The As of day is checked as the API would before it is sent, so a bad day keeps the last figures.
 */
export function TrialBalanceView({ options, onRefresh }: { options: ReportOptions; onRefresh: () => void }) {
  const formatDate = useFormatDate();
  const problemId = useId();
  const [typed, setTyped] = useState(() => api.today());
  const [applied, setApplied] = useState(typed);
  const [showEmpty, setShowEmpty] = useState(false);
  const problem = reportDayProblem(typed);
  const query = useApiQuery(
    async (client): Promise<KeyedAnswer<TrialBalance>> => ({
      reportKey: KEY,
      request: applied,
      report: await client.trialBalance(applied),
    }),
    [applied],
  );
  const shown = shownAnswer(query.data, KEY, applied);
  const tb = shown.report;
  const canExport = options.exports.includes(KEY);

  function changeDay(day: string) {
    setTyped(day);
    if (reportDayProblem(day) === null) setApplied(day);
  }

  function exportCsv() {
    if (!tb || shown.busy) return;
    downloadText(`trial-balance-${applied}.csv`, trialBalanceCsv(tb, showEmpty));
  }

  return (
    <Panel
      title={TITLE}
      actions={
        canExport ? (
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!tb || shown.busy}>
            <Download />
            Export CSV
          </Button>
        ) : null
      }
      bodyClassName="flex flex-col gap-4"
    >
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">As of</span>
          <Input
            type="date"
            aria-label="As of"
            min={`${REPORT_YEARS.from}-01-01`}
            max={`${REPORT_YEARS.to}-12-31`}
            value={typed}
            onChange={(e) => changeDay(e.target.value)}
            className="h-9 w-44"
            {...(problem ? { "aria-invalid": true, "aria-describedby": problemId } : {})}
          />
        </label>
        <label className="flex h-9 items-center gap-2 text-sm">
          <Switch checked={showEmpty} onCheckedChange={setShowEmpty} />
          Show accounts with no entries
        </label>
        <p id={problemId} aria-live="polite" className={problem ? "text-danger-ink basis-full text-sm" : "sr-only"}>
          {problem ? `${problem} The figures below are still as of ${formatDate(applied)}.` : null}
        </p>
      </div>
      {tb ? (
        <>
          <Proof tb={tb} />
          <TrialBalanceTable tb={tb} showEmpty={showEmpty} busy={shown.busy} />
        </>
      ) : (
        <ReportFallback query={query} className="h-64" label="Loading the trial balance" onRefresh={onRefresh} />
      )}
      <p className="text-muted-foreground text-xs">
        As of the end of {formatDate(applied)}. Figures come from the books: everything recorded since the company
        started using the app, not documents from before it.
      </p>
    </Panel>
  );
}
