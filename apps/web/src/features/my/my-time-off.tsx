"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { RequestTimeOffDialog } from "@/features/hr/request-time-off-dialog";
import { TeamCalendar } from "@/features/hr/team-calendar";
import { REQUEST_STATUS } from "@/features/hr/time-off-page";
import { api } from "@/lib/api";
import type { MyPortal } from "@/lib/api/contract";
import { useFormatDate } from "@/lib/use-format-date";
import { MyShell } from "./my-shell";

function TimeOff({ portal }: { portal: MyPortal }) {
  const formatDate = useFormatDate();
  const [asking, setAsking] = useState(false);
  const policies = portal.balances.map((b) => b.policy);
  const policyName = (id: string) => policies.find((p) => p.id === id)?.name ?? "Time off";

  async function cancel(id: string) {
    try {
      await api.cancelTimeOff(id);
      toast.success("Request cancelled");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "This request can't be cancelled.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button onClick={() => setAsking(true)}>
          <CalendarPlus />
          Request time off
        </Button>
      </div>
      <Panel title="Balances">
        <dl className="grid gap-3 sm:grid-cols-3">
          {portal.balances
            .filter((b) => b.policy.accrualMethod !== "none")
            .map((b) => (
              <div key={b.policy.id}>
                <dt className="text-muted-foreground text-xs">{b.policy.name}</dt>
                <dd className="font-display text-xl font-semibold">
                  <Num kind="quantity" value={b.hours} unit="hours" />
                </dd>
                {Number(b.pending) > 0 ? (
                  <dd className="text-muted-foreground text-xs">
                    <Num kind="quantity" value={b.pending} unit="hours" /> waiting for a decision
                  </dd>
                ) : null}
              </div>
            ))}
        </dl>
      </Panel>
      <Panel title="My requests" bodyClassName="p-0">
        {portal.requests.length === 0 ? (
          <p className="text-muted-foreground p-4 text-sm">No requests yet.</p>
        ) : (
          <ul className="divide-hairline divide-y text-sm">
            {portal.requests.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                <span>
                  {policyName(r.policyId)}, {formatDate(r.start)}
                  {r.end !== r.start ? ` to ${formatDate(r.end)}` : ""}
                  {r.decisionReason ? <span className="text-muted-foreground"> {r.decisionReason}</span> : null}
                </span>
                <span className="flex items-center gap-2">
                  <StatusPill {...REQUEST_STATUS[r.status]} />
                  {r.status === "pending" ? (
                    <Button size="sm" variant="ghost" onClick={() => void cancel(r.id)}>
                      Cancel
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {portal.visible.teamCalendar ? (
        <TeamCalendar requests={portal.teamOut} employees={portal.teamNames} kinds={false} />
      ) : null}
      {asking ? (
        <RequestTimeOffDialog employeeId={portal.employee!.id} policies={policies} onClose={() => setAsking(false)} />
      ) : null}
    </div>
  );
}

/** My time off (spec C2): balances, requests and their status. */
export function MyTimeOffPage() {
  return <MyShell title="My time off">{(p) => <TimeOff portal={p} />}</MyShell>;
}
