"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Banknote, CircleCheck, CircleDot, Clock, FilePlus2, TriangleAlert } from "lucide-react";
import {
  billLedgerIndex,
  dec,
  locationName,
  payablesSummary,
  poState,
  PO_STATE_LABELS,
  SENSITIVE,
  sum,
  supplierBalance,
  SUPPLIER_TERMS_LABELS,
  type Bill,
  type BillLedger,
  type PurchaseOrder,
  type Supplier,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { PageHeader } from "@workspace/ui/components/page-header";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { DueSummary } from "@/components/due-summary";
import { QueryFallback } from "@/components/query-fallback";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { NoAccess } from "@/components/no-access";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { NewOrderDialog } from "./new-order-dialog";
import { OrderDrawer } from "./order-drawer";
import { PoStatusPill } from "./po-status";
import { SupplierPaymentSheet } from "./supplier-payment-sheet";

type View = "suppliers" | "orders" | "bills";

/** A bill's state today from its ledger: paid, overdue past its due date, partly paid or open. */
function billPill(ledger: BillLedger) {
  if (ledger.state === "paid") return { tone: "success", icon: CircleCheck, label: "Paid" } as const;
  if (ledger.overdue) return { tone: "danger", icon: TriangleAlert, label: "Overdue" } as const;
  if (ledger.state === "partial") return { tone: "warning", icon: Clock, label: "Partly paid" } as const;
  return { tone: "brand", icon: CircleDot, label: "Open" } as const;
}

/**
 * Suppliers and purchasing (spec Tier 2, D1 to D3): suppliers with terms, credit and what is owed;
 * purchase orders from draft through receipts, bills and payments; and payables as Current and
 * Overdue with bills, what is left on each and Pay. Amounts need cost access.
 */
export function PurchasingPage() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const formatDate = useFormatDate();
  const [openPo, setOpenPo] = useState<PurchaseOrder | null>(null);
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Supplier | null>(null);
  const data = useApiQuery(async (client) => {
    const [suppliers, purchaseOrders, bills, products, locations, receipts, supplierPayments] = await Promise.all([
      client.list("suppliers"),
      client.list("purchaseOrders"),
      client.list("bills"),
      client.list("products"),
      client.list("locations"),
      client.list("receipts"),
      client.list("supplierPayments"),
    ]);
    return { suppliers, purchaseOrders, bills, products, locations, receipts, supplierPayments };
  }, []);
  if (!can("purchasing.order.view") && !can("purchasing.bill.view")) return <NoAccess />;
  const money = can(SENSITIVE.productCost) || can("purchasing.bill.view");
  const requested = params.get("view") as View | null;
  const view: View = requested ?? (can("purchasing.order.view") ? "orders" : "bills");
  const today = api.today();
  const d = data.data;
  const ledgers = billLedgerIndex(d?.bills ?? [], d?.supplierPayments ?? [], today);
  const supplierOf = (id: string) => d?.suppliers.find((s) => s.id === id);
  const warehouseOf = (poId: string | null) =>
    locationName(d?.locations ?? [], d?.purchaseOrders.find((p) => p.id === poId)?.locationId);
  const state = (p: PurchaseOrder) => poState(p, d!.receipts, d!.bills, d!.supplierPayments, today);
  const poRemaining = (p: PurchaseOrder) => {
    const own = d!.bills.filter((b) => b.poId === p.id);
    const paid = sum(own.map((b) => ledgers.get(b.id)!.paid));
    return dec(p.total).minus(paid).toString();
  };
  const balance = (s: Supplier) => supplierBalance(s, d!.bills, ledgers);

  const supplierColumns: ColumnSpec<Supplier>[] = [
    {
      id: "name",
      header: "Supplier",
      value: (s) => s.name,
      cell: (s) => <span className="font-medium">{s.name}</span>,
    },
    { id: "contact", header: "Contact", value: (s) => `${s.contactName}, ${s.phone}`, hidden: true },
    { id: "terms", header: "Terms", value: (s) => SUPPLIER_TERMS_LABELS[s.terms] },
    ...(money
      ? [
          { id: "owed", header: "Owed", kind: "money" as const, value: (s: Supplier) => balance(s).owed, total: true },
          {
            id: "overdue",
            header: "Overdue",
            kind: "money" as const,
            value: (s: Supplier) => balance(s).overdue,
            total: true,
          },
          { id: "limit", header: "Credit limit", kind: "money" as const, value: (s: Supplier) => s.creditLimit },
          {
            id: "used",
            header: "Credit used",
            kind: "percent" as const,
            value: (s: Supplier) => balance(s).creditUsedPct,
          },
          {
            id: "nextDue",
            header: "Next due",
            value: (s: Supplier) => balance(s).nextDueAt,
            cell: (s: Supplier) => {
              const next = balance(s).nextDueAt;
              return next ? formatDate(next) : <span className="text-muted-foreground">None</span>;
            },
          },
        ]
      : []),
    ...(can("purchasing.payment.record")
      ? [
          {
            id: "pay",
            header: "Pay",
            visualOnly: true,
            value: () => null,
            cell: (s: Supplier) =>
              dec(balance(s).owed).gt(0) ? (
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={`Pay ${s.name}`}
                  onClick={(e) => (e.stopPropagation(), setPaying(s))}
                >
                  <Banknote />
                  Pay
                </Button>
              ) : null,
          },
        ]
      : []),
  ];
  const orderColumns: ColumnSpec<PurchaseOrder>[] = [
    {
      id: "number",
      header: "Order",
      value: (p) => p.number,
      cell: (p) => <span className="font-medium">{p.number}</span>,
    },
    { id: "supplier", header: "Supplier", value: (p) => supplierOf(p.supplierId)?.name ?? "" },
    { id: "created", header: "Created", value: (p) => p.createdAt, cell: (p) => formatDate(p.createdAt) },
    { id: "expected", header: "Expected", value: (p) => p.expectedAt, cell: (p) => formatDate(p.expectedAt) },
    { id: "warehouse", header: "Receive into", value: (p) => warehouseOf(p.id) },
    {
      id: "status",
      header: "Status",
      value: (p) => PO_STATE_LABELS[state(p)],
      cell: (p) => <PoStatusPill state={state(p)} />,
    },
    ...(money
      ? [
          { id: "total", header: "Total", kind: "money" as const, value: (p: PurchaseOrder) => p.total, total: true },
          { id: "remaining", header: "Remaining", kind: "money" as const, value: poRemaining, total: true },
        ]
      : []),
  ];
  const billColumns: ColumnSpec<Bill>[] = [
    {
      id: "number",
      header: "Bill",
      value: (b) => b.number,
      cell: (b) => <span className="font-medium">{b.number}</span>,
    },
    { id: "supplier", header: "Supplier", value: (b) => supplierOf(b.supplierId)?.name ?? "" },
    { id: "po", header: "Order", value: (b) => d?.purchaseOrders.find((p) => p.id === b.poId)?.number ?? "" },
    { id: "issued", header: "Issued", value: (b) => b.issuedAt, cell: (b) => formatDate(b.issuedAt) },
    { id: "due", header: "Due", value: (b) => b.dueAt, cell: (b) => formatDate(b.dueAt) },
    { id: "warehouse", header: "Warehouse", value: (b) => warehouseOf(b.poId), hidden: true },
    {
      id: "state",
      header: "Status",
      value: (b) => billPill(ledgers.get(b.id)!).label,
      cell: (b) => <StatusPill {...billPill(ledgers.get(b.id)!)} />,
    },
    {
      id: "match",
      header: "Match",
      value: (b) => (b.matchIssues.length ? "Check" : "Matches"),
      cell: (b) =>
        b.matchIssues.length ? (
          <span className="text-warning-ink" title={b.matchIssues.join(" ")}>
            Check: {b.matchIssues[0]}
          </span>
        ) : (
          <span className="text-muted-foreground">Matches</span>
        ),
    },
    { id: "total", header: "Total", kind: "money", value: (b) => b.total, total: true },
    { id: "paid", header: "Paid", kind: "money", value: (b) => ledgers.get(b.id)!.paid, total: true },
    { id: "balance", header: "Remaining", kind: "money", value: (b) => ledgers.get(b.id)!.balance, total: true },
    ...(can("purchasing.payment.record")
      ? [
          {
            id: "pay",
            header: "Pay",
            visualOnly: true,
            value: () => null,
            cell: (b: Bill) =>
              dec(ledgers.get(b.id)!.balance).gt(0) ? (
                <Button size="sm" variant="outline" onClick={() => setPaying(supplierOf(b.supplierId) ?? null)}>
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
      <Tabs value={view} className="gap-6" onValueChange={(v) => router.replace(`/purchasing?view=${v}`)}>
        <TabsList aria-label="Purchasing view">
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
          {can("purchasing.order.view") ? <TabsTrigger value="orders">Purchase orders</TabsTrigger> : null}
          {can("purchasing.bill.view") ? <TabsTrigger value="bills">Bills and payables</TabsTrigger> : null}
        </TabsList>
        <TabsContent value={view} className="flex flex-col gap-6">
          {data.status !== "ready" || !d ? (
            <QueryFallback query={data} className="h-96" label="Loading purchasing" />
          ) : view === "suppliers" ? (
            <DataTable
              id="purchasing-suppliers"
              rows={d.suppliers}
              columns={supplierColumns}
              getRowId={(s) => s.id}
              searchPlaceholder="Search suppliers"
              csvName="suppliers"
              empty={{ message: "No suppliers yet." }}
            />
          ) : view === "bills" ? (
            <>
              <DueSummary title="Payables" basis="bill" {...payablesSummary(d.bills, ledgers, today)} />
              <DataTable
                id="purchasing-bills"
                rows={d.bills}
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
              rows={d.purchaseOrders}
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
        </TabsContent>
      </Tabs>
      {d && openPo ? (
        <OrderDrawer
          po={d.purchaseOrders.find((p) => p.id === openPo.id) ?? null}
          supplier={supplierOf(openPo.supplierId)}
          receipts={d.receipts}
          bills={d.bills}
          payments={d.supplierPayments}
          products={d.products}
          locations={d.locations}
          onClose={() => setOpenPo(null)}
        />
      ) : null}
      {d ? (
        <NewOrderDialog
          open={creating}
          onOpenChange={setCreating}
          suppliers={d.suppliers}
          products={d.products}
          locations={d.locations}
        />
      ) : null}
      {d && paying ? (
        <SupplierPaymentSheet supplier={paying} bills={d.bills} ledgers={ledgers} onClose={() => setPaying(null)} />
      ) : null}
      {money && d ? (
        <p className="text-muted-foreground text-xs">
          <Num kind="money" value={payablesSummary(d.bills, ledgers, today).total} /> owed to suppliers in all.
        </p>
      ) : null}
    </>
  );
}
