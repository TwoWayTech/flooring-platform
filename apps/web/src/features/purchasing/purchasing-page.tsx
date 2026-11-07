"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Banknote, CircleCheck, CircleDot, Clock, FilePlus2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import {
  balance,
  daysBetween,
  PAYMENT_TERM_LABELS,
  SENSITIVE,
  sum,
  type Bill,
  type PurchaseOrder,
  type Supplier,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { AgingPanel } from "@/components/aging-panel";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { NoAccess } from "@/components/no-access";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { NewOrderDialog } from "./new-order-dialog";
import { OrderDrawer } from "./order-drawer";
import { PoStatusPill, poStatusLabel } from "./po-status";

type View = "suppliers" | "orders" | "bills";

/** A bill's state today: paid, overdue past its due date, partly paid or open. */
function billState(bill: Bill, today: string) {
  if (balance(bill).lte(0)) return { tone: "success", icon: CircleCheck, label: "Paid" } as const;
  if (daysBetween(bill.dueAt, today) > 0) return { tone: "danger", icon: TriangleAlert, label: "Overdue" } as const;
  if (Number(bill.paid) > 0) return { tone: "warning", icon: Clock, label: "Partly paid" } as const;
  return { tone: "brand", icon: CircleDot, label: "Open" } as const;
}

/**
 * Suppliers and purchasing (spec Tier 2): suppliers with what is owed, purchase orders through
 * receive and bill, and payables with aging and payment. Amounts need cost access.
 */
export function PurchasingPage() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const formatDate = useFormatDate();
  const [openPo, setOpenPo] = useState<PurchaseOrder | null>(null);
  const [creating, setCreating] = useState(false);
  const data = useApiQuery(async (client) => {
    const [suppliers, purchaseOrders, bills, products] = await Promise.all([
      client.list("suppliers"),
      client.list("purchaseOrders"),
      client.list("bills"),
      client.list("products"),
    ]);
    return { suppliers, purchaseOrders, bills, products };
  }, []);
  if (!can("purchasing.order.view") && !can("purchasing.bill.view")) return <NoAccess />;
  const money = can(SENSITIVE.productCost) || can("purchasing.bill.view");
  const requested = params.get("view") as View | null;
  const view: View = requested ?? (can("purchasing.order.view") ? "orders" : "bills");
  const today = api.today();
  const supplierOf = (id: string) => data.data?.suppliers.find((s) => s.id === id);

  async function pay(bill: Bill) {
    await api.payBill(bill.id);
    toast.success(`Bill ${bill.number} paid`);
  }

  const owed = (s: Supplier) =>
    sum((data.data?.bills ?? []).filter((b) => b.supplierId === s.id).map(balance)).toString();
  const supplierColumns: ColumnSpec<Supplier>[] = [
    {
      id: "name",
      header: "Supplier",
      value: (s) => s.name,
      cell: (s) => <span className="font-medium">{s.name}</span>,
    },
    { id: "contact", header: "Contact", value: (s) => `${s.contactName}, ${s.phone}` },
    { id: "terms", header: "Terms", value: (s) => PAYMENT_TERM_LABELS[s.terms] },
    {
      id: "open",
      header: "Open orders",
      kind: "count",
      value: (s) =>
        (data.data?.purchaseOrders ?? []).filter((p) => p.supplierId === s.id && p.status !== "billed").length,
    },
    ...(money ? [{ id: "owed", header: "Owed", kind: "money" as const, value: owed }] : []),
  ];
  const orderColumns: ColumnSpec<PurchaseOrder>[] = [
    {
      id: "number",
      header: "Order",
      value: (p) => p.number,
      cell: (p) => <span className="font-medium">{p.number}</span>,
    },
    { id: "supplier", header: "Supplier", value: (p) => supplierOf(p.supplierId)?.name ?? "" },
    { id: "created", header: "Ordered", value: (p) => p.createdAt, cell: (p) => formatDate(p.createdAt) },
    { id: "expected", header: "Expected", value: (p) => p.expectedAt, cell: (p) => formatDate(p.expectedAt) },
    {
      id: "status",
      header: "Status",
      value: (p) => poStatusLabel(p.status),
      cell: (p) => <PoStatusPill status={p.status} />,
    },
    ...(money ? [{ id: "total", header: "Total", kind: "money" as const, value: (p: PurchaseOrder) => p.total }] : []),
  ];
  const billColumns: ColumnSpec<Bill>[] = [
    {
      id: "number",
      header: "Bill",
      value: (b) => b.number,
      cell: (b) => <span className="font-medium">{b.number}</span>,
    },
    { id: "supplier", header: "Supplier", value: (b) => supplierOf(b.supplierId)?.name ?? "" },
    { id: "issued", header: "Issued", value: (b) => b.issuedAt, cell: (b) => formatDate(b.issuedAt) },
    { id: "due", header: "Due", value: (b) => b.dueAt, cell: (b) => formatDate(b.dueAt) },
    {
      id: "state",
      header: "Status",
      value: (b) => billState(b, today).label,
      cell: (b) => <StatusPill {...billState(b, today)} />,
    },
    { id: "total", header: "Total", kind: "money", value: (b) => b.total },
    { id: "balance", header: "Balance", kind: "money", value: (b) => balance(b).toString() },
    ...(can("purchasing.bill.pay")
      ? [
          {
            id: "pay",
            header: "Pay",
            visualOnly: true,
            value: () => null,
            cell: (b: Bill) =>
              balance(b).gt(0) ? (
                <Button size="sm" variant="outline" onClick={() => void pay(b)}>
                  <Banknote />
                  Pay
                </Button>
              ) : null,
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Purchasing"
        actions={
          can("purchasing.order.create") ? (
            <Button onClick={() => setCreating(true)}>
              <FilePlus2 />
              New purchase order
            </Button>
          ) : null
        }
      />
      <Tabs value={view} onValueChange={(v) => router.replace(`/purchasing?view=${v}`)}>
        <TabsList aria-label="Purchasing view">
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          {can("purchasing.order.view") ? <TabsTrigger value="orders">Purchase orders</TabsTrigger> : null}
          {can("purchasing.bill.view") ? <TabsTrigger value="bills">Bills and payables</TabsTrigger> : null}
        </TabsList>
      </Tabs>
      {data.status !== "ready" ? (
        <Skeleton className="h-96" aria-label="Loading purchasing" />
      ) : view === "suppliers" ? (
        <DataTable
          id="purchasing-suppliers"
          rows={data.data.suppliers}
          columns={supplierColumns}
          getRowId={(s) => s.id}
          searchPlaceholder="Search suppliers"
          csvName="suppliers"
          empty={{ message: "No suppliers yet." }}
        />
      ) : view === "bills" ? (
        <>
          <AgingPanel title="Payables aging" docs={data.data.bills.filter((b) => balance(b).gt(0))} today={today} />
          <DataTable
            id="purchasing-bills"
            rows={data.data.bills}
            columns={billColumns}
            getRowId={(b) => b.id}
            searchPlaceholder="Search bills"
            csvName="bills"
            initialSort={{ id: "due", desc: true }}
            empty={{ message: "No bills yet. Bills come from received purchase orders." }}
          />
        </>
      ) : (
        <DataTable
          id="purchasing-orders"
          rows={data.data.purchaseOrders}
          columns={orderColumns}
          getRowId={(p) => p.id}
          onRowClick={setOpenPo}
          rowLabel={(p) => `Open ${p.number}`}
          searchPlaceholder="Search purchase orders"
          csvName="purchase-orders"
          initialSort={{ id: "created", desc: true }}
          empty={{ message: "No purchase orders yet. Create a purchase order." }}
        />
      )}
      <OrderDrawer
        po={openPo ? (data.data?.purchaseOrders.find((p) => p.id === openPo.id) ?? null) : null}
        supplier={openPo ? supplierOf(openPo.supplierId) : undefined}
        onClose={() => setOpenPo(null)}
      />
      {data.data ? (
        <NewOrderDialog
          open={creating}
          onOpenChange={setCreating}
          suppliers={data.data.suppliers}
          products={data.data.products}
        />
      ) : null}
    </>
  );
}
