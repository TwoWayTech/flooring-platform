"use client";

import { useState } from "react";
import { PackageCheck, ReceiptText } from "lucide-react";
import { toast } from "sonner";
import { SENSITIVE, UNIT_LABELS, type PurchaseOrder, type Supplier } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { Field } from "@/components/field";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useFormatDate } from "@/lib/use-format-date";
import { PoStatusPill } from "./po-status";

/** A purchase order's lines with the next step in its life: receive, then enter the bill. */
export function OrderDrawer({
  po,
  supplier,
  onClose,
}: {
  po: PurchaseOrder | null;
  supplier: Supplier | undefined;
  onClose: () => void;
}) {
  const can = useCan();
  const formatDate = useFormatDate();
  const [billNumber, setBillNumber] = useState("");
  const showCost = can(SENSITIVE.productCost);

  async function receive() {
    await api.receivePurchaseOrder(po!.id);
    toast.success(`${po!.number} received into stock`);
  }

  async function bill() {
    if (!billNumber.trim()) return toast.error("Enter the bill number from the supplier's invoice.");
    const created = await api.billPurchaseOrder(po!.id, billNumber.trim());
    toast.success(`Bill ${created.number} entered`);
    setBillNumber("");
  }

  return (
    <Sheet open={!!po} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="bg-surface w-full overflow-y-auto sm:max-w-lg">
        {po ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex items-center gap-3">
                {po.number}
                <PoStatusPill status={po.status} />
              </SheetTitle>
              <SheetDescription>
                {supplier?.name}, ordered {formatDate(po.createdAt)}, expected {formatDate(po.expectedAt)}
              </SheetDescription>
            </SheetHeader>
            <table className="mx-4 text-sm">
              <thead className="text-muted-foreground border-hairline border-b text-xs">
                <tr>
                  <th scope="col" className="py-1.5 text-left font-medium">
                    Item
                  </th>
                  <th scope="col" className="py-1.5 text-right font-medium">
                    Quantity
                  </th>
                  {showCost ? (
                    <th scope="col" className="py-1.5 text-right font-medium">
                      Unit cost
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {po.lines.map((l) => (
                  <tr key={l.id} className="border-hairline border-b">
                    <td className="py-1.5 pr-3">{l.description}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <Num
                        kind={l.unit === "sq_yd" ? "quantity" : "count"}
                        value={l.quantity}
                        unit={UNIT_LABELS[l.unit]}
                      />
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
              <p className="px-4 text-right text-sm font-semibold">
                Total <Num kind="money" value={po.total} />
              </p>
            ) : null}
            <div className="flex flex-col gap-3 px-4 pb-6">
              {(po.status === "sent" || po.status === "draft") && can("purchasing.order.receive") ? (
                <Button onClick={() => void receive()}>
                  <PackageCheck />
                  Receive into stock
                </Button>
              ) : null}
              {po.status === "received" && can("purchasing.bill.create") ? (
                <div className="flex items-end gap-2">
                  <Field id="bill-number" label="Supplier's bill number" className="flex-1">
                    <Input id="bill-number" value={billNumber} onChange={(e) => setBillNumber(e.target.value)} />
                  </Field>
                  <Button onClick={() => void bill()}>
                    <ReceiptText />
                    Enter bill
                  </Button>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
