"use client";

import { bonusPay, dec, GROSS_PAY_LABEL } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { NotShown } from "@/components/not-shown";
import type { MyPayRow, MyPortal } from "@/lib/api/contract";
import { useFormatDate } from "@/lib/use-format-date";
import { MyShell } from "./my-shell";

function Row({
  label,
  kind,
  value,
  unit,
}: {
  label: string;
  kind: "money" | "quantity";
  /** Absent when the server stripped it (a reserved pay-rate name, CLAUDE.md rule 5): shown as a dash. */
  value: string | undefined;
  unit?: string;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{value === undefined ? <NotShown /> : <Num kind={kind} value={value} unit={unit} />}</dd>
    </div>
  );
}

function PeriodCard({ row, showCommission, salaried }: { row: MyPayRow; showCommission: boolean; salaried: boolean }) {
  const formatDate = useFormatDate();
  const { line, period } = row;
  const bonus = bonusPay(line);
  return (
    <Panel title={`${formatDate(period.start)} to ${formatDate(period.end)}`}>
      <dl className="flex flex-col gap-1.5 text-sm">
        <Row label="Hours worked" kind="quantity" value={line.hoursWorked} unit="hours" />
        <Row label="Overtime hours" kind="quantity" value={line.overtimeHours} unit="hours" />
        <Row label="Paid leave" kind="quantity" value={line.paidLeaveHours} unit="hours" />
        <Row label="Unpaid leave" kind="quantity" value={line.unpaidLeaveHours} unit="hours" />
        {salaried ? (
          <Row label="Salary" kind="money" value={line.salaryAmount} />
        ) : (
          <Row label="Hours pay" kind="money" value={line.straightTimePay} />
        )}
        <Row label="Overtime pay" kind="money" value={line.overtimePremium} />
        <Row label="Paid leave pay" kind="money" value={line.paidLeavePay} />
        {dec(bonus).gt(0) ? <Row label="Bonus" kind="money" value={bonus} /> : null}
        {showCommission ? (
          <>
            <Row label="Commission" kind="money" value={line.commissionPay} />
            <Row label="Overtime on commission" kind="money" value={line.overtimeTrueUp} />
          </>
        ) : null}
        {dec(line.salaryDeduction).gt(0) ? (
          <Row label="Unpaid leave deducted" kind="money" value={`-${line.salaryDeduction}`} />
        ) : null}
        <div className="border-hairline flex justify-between gap-3 border-t pt-2 font-medium">
          <dt>{showCommission ? "Gross pay" : "Estimated gross pay from hours and leave"}</dt>
          <dd>
            <Num kind="money" value={line.grossPay} />
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

/**
 * My pay's content from the portal answer (spec C2). Whether a line is salaried comes from the
 * person's own pay type, because the API strips the line's `salaryAmount` from anyone without
 * hr.employee.view_sensitive (finding #26: reading it crashed the page for every Employee and Manager).
 */
export function MyPayView({ portal }: { portal: MyPortal }) {
  const salariedType = portal.employee?.payType === "salary";
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-sm">{GROSS_PAY_LABEL}</p>
      <Panel title="Earned to date this year">
        <p className="font-display text-2xl font-semibold">
          <Num kind="money" value={portal.earnedThisYear} />
        </p>
      </Panel>
      {portal.pay.length === 0 ? (
        <p className="text-muted-foreground text-sm">No pay periods have been approved yet.</p>
      ) : null}
      {portal.pay.map((row) => (
        <PeriodCard
          key={row.period.id}
          row={row}
          showCommission={portal.visible.commission}
          salaried={salariedType || dec(row.line.salaryAmount ?? "0").gt(0)}
        />
      ))}
    </div>
  );
}

/** My pay (spec C2, ADR 0024): gross pay per period with the breakdown; hidden commission leaves no trace. */
export function MyPayPage() {
  return (
    <MyShell title="My pay">
      {(p) =>
        p.visible.pay ? (
          <MyPayView portal={p} />
        ) : (
          <p className="text-muted-foreground">Your company does not show pay here.</p>
        )
      }
    </MyShell>
  );
}
