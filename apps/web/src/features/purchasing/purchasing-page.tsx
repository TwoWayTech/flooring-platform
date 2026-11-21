"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Banknote, CircleCheck, CircleDot, Clock, FilePlus2, TriangleAlert, UserPlus } from "lucide-react";
import {
  billLedgerIndex,
  featureOn,
  callNumber,
  contactsOf,
  dec,
  locationName,
  payablesSummary,
  poState,
  PO_STATE_LABELS,
  SENSITIVE,
  sum,
  supplierBalance,
  supplierProfileGaps,
  SUPPLIER_TERMS_LABELS,
  SUPPLIER_TYPE_LABELS,
  type Bill,
  type BillLedger,
  type PurchaseOrder,
  type Supplier,
} from "@workspace/shared";
import { Badge } from "@workspace/ui/components/badge";
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
import { OWED_ON_BILLS, PO_NOT_PAID_HEADER, PO_NOT_PAID_NOTE } from "./owed-labels";
import { BillDrawer } from "./bill-drawer";
import { PoStatusPill } from "./po-status";
import { SupplierDrawer } from "./supplier-drawer";
import { SupplierFormDialog } from "./supplier-form-dialog";
import { SupplierPaymentSheet } from "./supplier-payment-sheet";

type View = "suppliers" | "orders" | "bills";

/** A bill's state today from its ledger: paid, overdue past its due date, partly paid or open. */
function billPill(ledger: BillLedger) {
  if (ledger.state === "paid") return { tone: "success", icon: CircleCheck, label: "Paid" } as const;
  if (dec(ledger.pending).gt(0)) return { tone: "warning", icon: Clock, label: "Pending verification" } as const;
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
  const [openPoId, setOpenPoId] = useState<string | null>(params.get("po"));
  const [openSupplier, setOpenSupplier] = useState<Supplier | null>(null);
  const [openBill, setOpenBill] = useState<Bill | null>(null);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [creating, setCreating] = useState(false);
  const [paying, setPaying] = useState<Supplier | null>(null);
  const data = useApiQuery(async (client) => {
    const { suppliers, contacts, purchaseOrders, bills, products, locations, receipts, supplierPayments } =
      await client.purchasingData();
    return { suppliers, contacts, purchaseOrders, bills, products, locations, receipts, supplierPayments };
  }, []);
  if (!can("purchasing.order.view") && !can("purchasing.bill.view")) return <NoAccess />;
  const money = can(SENSITIVE.productCost) || can("purchasing.bill.view");
  const requested = params.get("view") as View | null;
  const suppliersOn = featureOn("purchasing.suppliers");
  const view: View =
    (suppliersOn || requested !== "suppliers" ? requested : null) ??
    (can("purchasing.order.view") ? "orders" : "bills");
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
  const contactLine = (s: Supplier) => {
    const primary = contactsOf(s.id, d!.contacts)[0];
    return primary ? `${primary.name}, ${callNumber(primary) || primary.email}` : "No contacts yet";
  };

  const supplierColumns: ColumnSpec<Supplier>[] = [
    {
      id: "name",
      header: "Supplier",
      value: (s) => s.name,
      cell: (s) => (
        <span className="flex flex-col">
          <span className="flex items-center gap-2">
            <span className="font-medium">{s.name}</span>
            {s.status === "inactive" ? <Badge variant="outline">Inactive</Badge> : null}
            {supplierProfileGaps(s, d!.contacts).length ? <Badge variant="outline">Profile incomplete</Badge> : null}
          </span>
          <span className="text-muted-foreground text-xs">{contactLine(s)}</span>
        </span>
      ),
    },
    { id: "type", header: "Type", filter: "select", value: (s) => SUPPLIER_TYPE_LABELS[s.type] },
    { id: "account", header: "Our account", value: (s) => s.accountNumber, hidden: true },
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
          { id: "remaining", header: PO_NOT_PAID_HEADER, kind: "money" as const, value: poRemaining, total: true },
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
              dec(ledgers.get(b.id)!.unpaid).gt(0) ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPaying(supplierOf(b.supplierId) ?? null);
                  }}
                >
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
          <span className="flex flex-wrap gap-2">
            {can("purchasing.supplier.create") ? (
              <Button variant="outline" onClick={() => setAddingSupplier(true)}>
                <UserPlus />
                Add supplier
              </Button>
            ) : null}
            {can("purchasing.order.create") ? (
              <Button onClick={() => setCreating(true)}>
                <FilePlus2 />
                New purchase order
              </Button>
            ) : null}
          </span>
        }
      />
      <Tabs value={view} className="gap-6" onValueChange={(v) => router.replace(`/purchasing?view=${v}`)}>
        <TabsList aria-label="Purchasing view">
          {suppliersOn ? <TabsTrigger value="suppliers">Suppliers</TabsTrigger> : null}
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
              onRowClick={setOpenSupplier}
              rowLabel={(s) => `Open ${s.name}`}
              searchPlaceholder="Search suppliers"
              csvName="suppliers"
              empty={{ message: "No suppliers yet. Add the first one." }}
            />
          ) : view === "bills" ? (
            <>
              <DueSummary title="Payables" basis="bill" {...payablesSummary(d.bills, ledgers, today)} />
              <DataTable
                id="purchasing-bills"
                rows={d.bills}
                columns={billColumns}
                getRowId={(b) => b.id}
                onRowClick={setOpenBill}
                rowLabel={(b) => `Open bill ${b.number}`}
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
              onRowClick={(p) => setOpenPoId(p.id)}
              rowLabel={(p) => `Open ${p.number}`}
              searchPlaceholder="Search purchase orders"
              csvName="purchase-orders"
              initialSort={{ id: "created", desc: true }}
              empty={{ message: "No purchase orders yet. Create a purchase order." }}
            />
          )}
        </TabsContent>
      </Tabs>
      {d && openPoId ? (
        <OrderDrawer
          po={d.purchaseOrders.find((p) => p.id === openPoId) ?? null}
          supplier={supplierOf(d.purchaseOrders.find((p) => p.id === openPoId)?.supplierId ?? "")}
          contacts={d.contacts}
          onOpenBill={setOpenBill}
          receipts={d.receipts}
          bills={d.bills}
          payments={d.supplierPayments}
          products={d.products}
          locations={d.locations}
          onClose={() => setOpenPoId(null)}
        />
      ) : null}
      {d ? (
        <NewOrderDialog
          open={creating}
          onOpenChange={setCreating}
          suppliers={d.suppliers}
          contacts={d.contacts}
          products={d.products}
          locations={d.locations}
        />
      ) : null}
      {d && paying ? (
        <SupplierPaymentSheet supplier={paying} bills={d.bills} ledgers={ledgers} onClose={() => setPaying(null)} />
      ) : null}
      {d && openSupplier ? (
        <SupplierDrawer
          supplier={d.suppliers.find((s) => s.id === openSupplier.id) ?? openSupplier}
          suppliers={d.suppliers}
          contacts={d.contacts}
          balance={balance(d.suppliers.find((s) => s.id === openSupplier.id) ?? openSupplier)}
          onClose={() => setOpenSupplier(null)}
        />
      ) : null}
      {d && openBill ? (
        <BillDrawer
          bill={d.bills.find((b) => b.id === openBill.id) ?? openBill}
          ledger={ledgers.get(openBill.id)!}
          supplier={supplierOf(openBill.supplierId)}
          order={d.purchaseOrders.find((p) => p.id === openBill.poId)}
          receipts={d.receipts}
          payments={d.supplierPayments}
          onClose={() => setOpenBill(null)}
        />
      ) : null}
      {d && addingSupplier ? (
        <SupplierFormDialog supplier={null} suppliers={d.suppliers} onClose={() => setAddingSupplier(false)} />
      ) : null}
      {money && d ? (
        <p className="text-muted-foreground text-xs">
          <Num kind="money" value={payablesSummary(d.bills, ledgers, today).total} /> {OWED_ON_BILLS}
          {view === "orders" ? ` ${PO_NOT_PAID_NOTE}` : null}
        </p>
      ) : null}
    </>
  );
}
