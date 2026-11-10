"use client";

import { useState } from "react";
import { Ban, PackageCheck, ReceiptText, Send } from "lucide-react";
import { toast } from "sonner";
import {
  dec,
  locationName,
  poState,
  receivedByLine,
  SENSITIVE,
  unbilledReceipts,
  UNIT_LABELS,
  type Bill,
  type GoodsReceipt,
  type Location,
  type Product,
  type PurchaseOrder,
  type Supplier,
  type SupplierPayment,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { CartonHint } from "@/components/quantity/carton-hint";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { ReasonDialog } from "@/components/reason-dialog";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useFormatDate } from "@/lib/use-format-date";
import { BillDialog } from "./bill-dialog";
import { PoStatusPill } from "./po-status";
import { ReceiptDialog } from "./receipt-dialog";

/**
 * A purchase order and its next steps (spec D1, D2): Order a draft, Cancel before anything arrives,
 * Receive (partial receipts allowed), and Enter bill against what was received but not billed.
 */
export function OrderDrawer({
  po,
  supplier,
  receipts,
  bills,
  payments,
  products,
  locations,
  onClose,
}: {
  po: PurchaseOrder | null;
  supplier: Supplier | undefined;
  receipts: GoodsReceipt[];
  bills: Bill[];
  payments: SupplierPayment[];
  products: Product[];
  locations: Location[];
  onClose: () => void;
}) {
  const can = useCan();
  const formatDate = useFormatDate();
  const [dialog, setDialog] = useState<"receive" | "bill" | "cancel" | null>(null);
  const showCost = can(SENSITIVE.productCost);
  if (!po) return <Sheet open={false} />;
  const today = api.today();
  const state = poState(po, receipts, bills, payments, today);
  const got = receivedByLine(po.id, receipts);
  const own = receipts.filter((r) => r.poId === po.id);
  const toBill = unbilledReceipts(po, receipts, bills);
  const open = po.lines.some((l) => (got.get(l.id) ?? dec(0)).lt(l.quantity));
  const run = (work: Promise<unknown>, done: string) =>
    work
      .then(() => toast.success(done))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Not saved."));

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="bg-surface w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-3">
            {po.number}
            <PoStatusPill state={state} />
          </SheetTitle>
          <SheetDescription>
            {supplier?.name}, receive into {locationName(locations, po.locationId)}, expected{" "}
            {formatDate(po.expectedAt)}
          </SheetDescription>
          <div className="flex flex-wrap gap-2">
            {po.status === "draft" && can("purchasing.order.create") ? (
              <Button size="sm" onClick={() => void run(api.markOrdered(po.id), `${po.number} ordered`)}>
                <Send />
                Place order
              </Button>
            ) : null}
            {po.status === "ordered" && open && can("purchasing.order.receive") ? (
              <Button size="sm" onClick={() => setDialog("receive")}>
                <PackageCheck />
                Receive
              </Button>
            ) : null}
            {toBill.length > 0 && can("purchasing.bill.create") ? (
              <Button size="sm" variant={open ? "outline" : "default"} onClick={() => setDialog("bill")}>
                <ReceiptText />
                Enter bill
              </Button>
            ) : null}
            {po.status !== "cancelled" && own.length === 0 && can("purchasing.order.create") ? (
              <Button size="sm" variant="ghost" onClick={() => setDialog("cancel")}>
                <Ban />
                Cancel order
              </Button>
            ) : null}
          </div>
        </SheetHeader>
        <div className="overflow-x-auto px-4">
          <table className="w-full min-w-[28rem] text-sm">
            <thead className="text-muted-foreground border-hairline border-b text-xs">
              <tr>
                <th scope="col" className="py-1.5 text-left font-medium">
                  Item
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Ordered
                </th>
                <th scope="col" className="py-1.5 text-right font-medium">
                  Received
                </th>
                {showCost ? (
                  <th scope="col" className="py-1.5 text-right font-medium">
                    Cost
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id} className="border-hairline border-b align-top">
                  <td className="py-1.5 pr-3">
                    <span className="line-clamp-2 break-words" title={l.description}>
                      {l.description}
                    </span>
                    <CartonHint quantity={l.quantity} sqFtPerCarton={l.sqFtPerCarton} className="block" />
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <Num kind="quantity" value={l.quantity} unit={UNIT_LABELS[l.unit]} />
                  </td>
                  <td className="py-1.5 text-right whitespace-nowrap">
                    <Num kind="quantity" value={(got.get(l.id) ?? dec(0)).toString()} unit={UNIT_LABELS[l.unit]} />
                  </td>
                  {showCost ? (
                    <td className="py-1.5 text-right">
                      <Num kind="unitCost" value={l.unitCost} />
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          {showCost ? (
            <p className="mt-2 text-right text-sm font-semibold">
              Total <Num kind="money" value={po.total} />
            </p>
          ) : null}
        </div>
        {own.length > 0 ? (
          <section className="px-4 pb-6 text-sm">
            <h3 className="mb-1 font-semibold">Receipts</h3>
            <ul className="flex flex-col gap-1">
              {own.map((r) => (
                <li key={r.id}>
                  {r.number}, {formatDate(r.receivedAt.slice(0, 10))}, {r.receivedBy}, into{" "}
                  {locationName(locations, r.locationId)}
                  {toBill.includes(r) ? <span className="text-warning-ink"> (not billed yet)</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {dialog === "receive" ? (
          <ReceiptDialog
            po={po}
            receipts={receipts}
            products={products}
            locations={locations}
            onClose={() => setDialog(null)}
          />
        ) : null}
        {dialog === "bill" ? <BillDialog po={po} receipts={toBill} onClose={() => setDialog(null)} /> : null}
        {dialog === "cancel" ? (
          <ReasonDialog
            title={`Cancel ${po.number}`}
            description="The order stays in the list as Cancelled."
            confirmLabel="Cancel order"
            destructive
            onConfirm={(reason) => api.cancelOrder(po.id, reason).then(() => toast.success(`${po.number} cancelled`))}
            onClose={() => setDialog(null)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
