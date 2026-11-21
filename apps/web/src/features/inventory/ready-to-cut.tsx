"use client";

import Link from "next/link";
import { Scissors } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  formatNumber,
  locationName,
  STOCK_UNIT_LABELS,
  stockUnit,
  type Location,
  type Product,
  type Roll,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { useNumberSettings } from "@workspace/ui/components/number-settings";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CartonHint } from "@/components/quantity/carton-hint";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import type { StockHold } from "@/lib/api/contract";
import { stockIssueWords } from "@/features/invoices/stock-issue-words";

/**
 * Ready to cut (audit U-22): reserved stock whose invoice has confirmed money in, so it may be cut
 * or issued now. Warehouse staff do not see the Sales menu, so this list is where their paid work
 * shows up; the store gives just the invoice number, customer and quantity. Cut and Issue ask first,
 * with the invoice Stock panel's words (click-through #17).
 */
export function ReadyToCut({
  holds,
  products,
  rolls,
  locations,
  warehouseId,
}: {
  holds: StockHold[];
  products: Product[];
  rolls: Roll[];
  locations: Location[];
  warehouseId: string | null;
}) {
  const can = useCan();
  const numbers = useNumberSettings();
  const [confirming, setConfirming] = useState<StockHold | null>(null);
  const rows = holds.filter(
    (h) => h.mayIssue && Number(h.quantity) > 0 && (!warehouseId || h.locationId === warehouseId),
  );
  const product = (h: StockHold) => products.find((p) => p.id === h.productId);
  const unit = (h: StockHold) => {
    const p = product(h);
    return STOCK_UNIT_LABELS[(p && stockUnit(p)) || "each"];
  };

  // Cutting or issuing can't be undone, so it asks first with the invoice panel's words (click-through #17).
  const wordsFor = (hold: StockHold) =>
    stockIssueWords({
      quantity: formatNumber(hold.quantity, "quantity", numbers),
      unit: hold.rollId ? "ft" : unit(hold),
      rollNumber: hold.rollId ? (rolls.find((r) => r.id === hold.rollId)?.rollNumber ?? null) : null,
      invoiceNumber: hold.invoiceNumber,
    });

  const issue = (hold: StockHold) =>
    api.issueReservation(hold.reservationId).then(() => toast.success(wordsFor(hold).done));

  const columns: ColumnSpec<StockHold>[] = [
    { id: "invoice", header: "Invoice", value: (h) => h.invoiceNumber },
    { id: "customer", header: "Customer", value: (h) => h.customerName },
    { id: "product", header: "Item", value: (h) => product(h)?.name ?? "" },
    {
      id: "from",
      header: "From",
      value: (h) => rolls.find((r) => r.id === h.rollId)?.rollNumber ?? locationName(locations, h.locationId),
      cell: (h) => {
        const roll = rolls.find((r) => r.id === h.rollId);
        return roll ? (
          <Link href={`/inventory/rolls/${roll.id}`} className="text-brand-ink underline-offset-4 hover:underline">
            Roll {roll.rollNumber}
          </Link>
        ) : (
          locationName(locations, h.locationId)
        );
      },
    },
    { id: "warehouse", header: "Warehouse", value: (h) => locationName(locations, h.locationId), filter: false },
    {
      id: "quantity",
      header: "Quantity",
      kind: "quantity",
      value: (h) => Number(h.quantity),
      cell: (h) => (
        <span className="inline-flex flex-col items-end">
          <Num kind="quantity" value={h.quantity} unit={unit(h)} />
          {h.rollId ? null : <CartonHint quantity={h.quantity} sqFtPerCarton={product(h)?.sqFtPerCarton} compact />}
        </span>
      ),
    },
    {
      id: "action",
      header: "Action",
      visualOnly: true,
      value: () => null,
      cell: (h) =>
        can("inventory.roll.cut") ? (
          <Button size="sm" onClick={() => setConfirming(h)}>
            <Scissors />
            {h.rollId ? "Cut" : "Issue"}
          </Button>
        ) : null,
    },
  ];
  return (
    <>
      <DataTable
        id="inventory-ready"
        rows={rows}
        columns={columns}
        getRowId={(h) => h.reservationId}
        searchPlaceholder="Search invoices and customers"
        empty={{ message: "Nothing is ready to cut. Paid invoices with reserved stock appear here." }}
      />
      {confirming ? (
        <ConfirmDialog
          title={wordsFor(confirming).title}
          description={wordsFor(confirming).description}
          confirmLabel={wordsFor(confirming).confirmLabel}
          onConfirm={() => issue(confirming)}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </>
  );
}
