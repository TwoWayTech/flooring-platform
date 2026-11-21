"use client";

import { useState } from "react";
import { Ban, PackageCheck, ReceiptText, Send, FileDown } from "lucide-react";
import { toast } from "sonner";
import {
  damagedByLine,
  damagedLines,
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
  type SupplierContact,
  type SupplierPayment,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { CartonHint } from "@/components/quantity/carton-hint";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { ReasonDialog } from "@/components/reason-dialog";
import { ScrollRegion } from "@/components/scroll-region";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { saveBlob } from "@/lib/save-blob";
import { api } from "@/lib/api";
import { useFormatDate } from "@/lib/use-format-date";
import { BillDialog } from "./bill-dialog";
import { PoStatusPill } from "./po-status";
import { DamagedLines, DamagedQuantity } from "./damaged-quantity";
import { ReceiptDialog } from "./receipt-dialog";

/**
 * A quantity with its unit in a narrow column: the number never breaks, and the unit drops to the
 * next line before it would run into the column beside it (click-through #23).
 */
function QuantityCell({ value, unit }: { value: string; unit: string }) {
  return (
    <>
      <Num kind="quantity" value={value} className="whitespace-nowrap" />{" "}
      <span className="whitespace-nowrap">{unit}</span>
    </>
  );
}

/**
 * A purchase order and its next steps (spec D1, D2): Order a draft, Cancel before anything arrives,
 * Receive (partial receipts allowed), and Enter bill against what was received but not billed.
 */
export function OrderDrawer({
  po,
  supplier,
  contacts,
  onOpenBill,
  receipts,
  bills,
  payments,
  products,
  locations,
  onClose,
}: {
  po: PurchaseOrder | null;
  supplier: Supplier | undefined;
  contacts: SupplierContact[];
  onOpenBill: (bill: Bill) => void;
  receipts: GoodsReceipt[];
  bills: Bill[];
  payments: SupplierPayment[];
  products: Product[];
  locations: Location[];
  onClose: () => void;
}) {
  const can = useCan();
  const { settings } = useWorkspace();
  const formatDate = useFormatDate();
  const [dialog, setDialog] = useState<"receive" | "bill" | "cancel" | null>(null);
  const showCost = can(SENSITIVE.productCost);
  if (!po) return <Sheet open={false} />;
  const today = api.today();
  const state = poState(po, receipts, bills, payments, today);
  const got = receivedByLine(po.id, receipts);
  const damaged = damagedByLine(po.id, receipts);
  const own = receipts.filter((r) => r.poId === po.id);
  const toBill = unbilledReceipts(po, receipts, bills);
  const open = po.lines.some((l) => (got.get(l.id) ?? dec(0)).lt(l.quantity));
  const orderBills = bills.filter((b) => b.poId === po.id);
  const contact = contacts.find((c) => c.id === po.contactId);
  const rep = po.contactSnapshot?.name ?? contact?.name ?? "";
  const canEmail = !!(po.contactSnapshot?.email || contact?.email || supplier?.email);
  /** Renders the purchase order PDF in the browser; @react-pdf/renderer loads only when asked. */
  async function downloadPdf() {
    const [{ pdf }, { PoPdf, buildPoModel }] = await Promise.all([import("@react-pdf/renderer"), import("./po-pdf")]);
    const model = buildPoModel(po!, supplier, rep, locations, settings);
    saveBlob(await pdf(<PoPdf model={model} />).toBlob(), `${model.number}.pdf`);
  }
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
            {supplier?.name}
            {rep ? `, attention ${rep}` : ""}, receive into {locationName(locations, po.locationId)}, expected{" "}
            {formatDate(po.expectedAt)}
            {po.supplierRef ? `, their order ${po.supplierRef}` : ""}
            {po.placedVia === "phone" ? ", placed by phone" : ""}
          </SheetDescription>
          <div className="flex flex-wrap gap-2">
            {po.status === "draft" && can("purchasing.order.create") ? (
              <Button
                size="sm"
                onClick={() => void run(api.markOrdered(po.id, canEmail ? "email" : "phone"), `${po.number} ordered`)}
              >
                <Send />
                {canEmail ? "Place order" : "Mark as ordered by phone"}
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
            <Button size="sm" variant="outline" onClick={() => void downloadPdf()}>
              <FileDown />
              Download PDF
            </Button>
            {po.status !== "cancelled" && own.length === 0 && can("purchasing.order.create") ? (
              <Button size="sm" variant="ghost" onClick={() => setDialog("cancel")}>
                <Ban />
                Cancel order
              </Button>
            ) : null}
          </div>
        </SheetHeader>
        <ScrollRegion label="Order lines" className="px-4">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground border-hairline border-b text-xs">
              <tr>
                <th scope="col" className="py-1.5 text-left font-medium">
                  Item
                </th>
                <th scope="col" className="py-1.5 pl-4 text-right font-medium">
                  Ordered
                </th>
                <th scope="col" className="py-1.5 pl-4 text-right font-medium">
                  Received
                </th>
                {showCost ? (
                  <th scope="col" className="py-1.5 pl-4 text-right font-medium">
                    Cost
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {po.lines.map((l) => {
                const lost = damaged.get(l.id);
                return (
                  <tr key={l.id} className="border-hairline border-b align-top">
                    <td className="py-1.5">
                      <span className="line-clamp-2 break-words" title={l.description}>
                        {l.description}
                      </span>
                      <CartonHint quantity={l.quantity} sqFtPerCarton={l.sqFtPerCarton} className="block" />
                    </td>
                    <td className="py-1.5 pl-4 text-right">
                      <QuantityCell value={l.quantity} unit={UNIT_LABELS[l.unit]} />
                    </td>
                    <td className="py-1.5 pl-4 text-right">
                      <QuantityCell value={(got.get(l.id) ?? dec(0)).toString()} unit={UNIT_LABELS[l.unit]} />
                      {lost ? (
                        <span className="text-warning-ink block text-xs">
                          <DamagedQuantity quantity={lost.toString()} unit={l.unit} sqFtPerCarton={l.sqFtPerCarton} />
                        </span>
                      ) : null}
                    </td>
                    {showCost ? (
                      <td className="py-1.5 pl-4 text-right whitespace-nowrap">
                        <Num kind="unitCost" value={l.unitCost} />
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {showCost ? (
            <p className="mt-2 text-right text-sm font-semibold">
              Total <Num kind="money" value={po.total} />
            </p>
          ) : null}
        </ScrollRegion>
        {orderBills.length > 0 ? (
          <section className="px-4 text-sm" aria-label="Bills">
            <h3 className="mb-1 font-semibold">Bills</h3>
            <ul className="flex flex-col gap-1">
              {orderBills.map((b) => (
                <li key={b.id}>
                  <button
                    type="button"
                    className="text-brand-ink underline-offset-4 hover:underline"
                    onClick={() => onOpenBill(b)}
                  >
                    {b.number}
                  </button>{" "}
                  <Num kind="money" value={b.total} />
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {own.length > 0 ? (
          <section className="px-4 pb-6 text-sm">
            <h3 className="mb-1 font-semibold">Receipts</h3>
            <ul className="flex flex-col gap-1">
              {own.map((r) => (
                <li key={r.id}>
                  {r.number}, {formatDate(r.receivedAt)}, {r.receivedBy}, into {locationName(locations, r.locationId)}
                  {toBill.includes(r) ? <span className="text-warning-ink"> (not billed yet)</span> : null}
                  <DamagedLines lines={damagedLines(po, [r])} className="text-warning-ink text-xs" />
                  {r.note ? <span className="text-muted-foreground block text-xs">Note: {r.note}</span> : null}
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
