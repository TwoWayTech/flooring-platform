"use client";

import Link from "next/link";
import { addDays, contractFigures, dec, moneyString, sum } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";

/** The dashboard's Contracts widget (spec D2): milestones due, contracts ending soon and retainage held. */
export function ContractsWidget() {
  const data = useApiQuery(async (client) => {
    const [contracts, lines, billings, orders] = await Promise.all([
      client.list("contracts"),
      client.list("contractLines"),
      client.list("contractBillings"),
      client.list("changeOrders"),
    ]);
    return { contracts, lines, billings, orders };
  }, []);
  if (data.status !== "ready") return null;
  const { contracts, lines, billings, orders } = data.data;
  const today = api.today();
  const soon = addDays(today, 60);
  const running = contracts.filter((c) => c.status === "active" || c.status === "completed");
  const ids = new Set(running.map((c) => c.id));
  const milestones = lines.filter(
    (l) =>
      ids.has(l.contractId) && l.milestoneDueAt && l.milestoneDueAt >= today && l.milestoneDueAt <= addDays(today, 30),
  );
  const ending = running.filter((c) => c.status === "active" && c.endsAt >= today && c.endsAt <= soon);
  const heldOn = (direction: "customer" | "subcontractor") =>
    moneyString(
      sum(
        running
          .filter((c) => c.direction === direction)
          .map((c) => dec(contractFigures(c, lines, billings, orders).held)),
      ),
    );
  return (
    <Panel title="Contracts">
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Milestones due in 30 days</dt>
          <dd className="tabular-nums">{milestones.length}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Ending in 60 days</dt>
          <dd className="tabular-nums">{ending.length}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Retainage customers hold</dt>
          <dd>
            <Num kind="money" value={heldOn("customer")} />
          </dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Retainage we hold</dt>
          <dd>
            <Num kind="money" value={heldOn("subcontractor")} />
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-sm">
        <Link className="text-brand-ink underline underline-offset-2" href="/contracts">
          View contracts
        </Link>
      </p>
    </Panel>
  );
}
