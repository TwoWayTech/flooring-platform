"use client";

import Link from "next/link";
import { Panel } from "@workspace/ui/components/panel";
import { Num } from "@workspace/ui/components/num";
import { useApiQuery } from "@/lib/api/use-api";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { addDays, poState } from "@workspace/shared";

function Row({ count, label, href }: { count: number; label: string; href: string }) {
  return (
    <li>
      <Link href={href} className="hover:bg-raised -mx-2 flex items-baseline gap-2 rounded px-2 py-1.5 text-sm">
        <span className="font-display w-10 text-right text-lg font-semibold">
          <Num kind="count" value={count} />
        </span>
        {label}
      </Link>
    </li>
  );
}

/**
 * The warehouse's day (audit U-22): orders due in the next week, transfers still to receive and
 * paid stock ready to cut, each linking to where it is done. Counted for the person's own
 * warehouse when they have one.
 */
export function WarehouseToday() {
  const { user } = useWorkspace();
  const data = useApiQuery(async (client) => {
    const [orders, receipts, bills, payments, transfers, holds] = await Promise.all([
      client.list("purchaseOrders"),
      client.list("receipts"),
      client.list("bills"),
      client.list("supplierPayments"),
      client.list("transfers"),
      client.listStockHolds(),
    ]);
    return { orders, receipts, bills, payments, transfers, holds };
  }, []);
  if (data.status !== "ready") return null;
  const { orders, receipts, bills, payments, transfers, holds } = data.data;
  const today = api.today();
  const here = user.defaultLocationId;
  const soon = addDays(today, 7);
  const due = orders.filter(
    (o) =>
      (!here || o.locationId === here) &&
      o.expectedAt <= soon &&
      ["ordered", "partly_received"].includes(poState(o, receipts, bills, payments, today)),
  );
  const incoming = transfers.filter((t) => t.status === "in_transit" && (!here || t.toId === here));
  const ready = holds.filter((h) => h.mayIssue && Number(h.quantity) > 0 && (!here || h.locationId === here));
  return (
    <Panel title="Warehouse today">
      <ul className="flex flex-col gap-0.5">
        <Row count={due.length} label="purchase orders due within a week" href="/purchasing?view=orders" />
        <Row count={incoming.length} label="transfers to receive" href="/inventory?view=transfers" />
        <Row count={ready.length} label="paid invoices ready to cut or issue" href="/inventory?view=ready" />
      </ul>
    </Panel>
  );
}
