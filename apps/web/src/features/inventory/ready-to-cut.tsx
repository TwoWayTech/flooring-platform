"use client";

import Link from "next/link";
import { Scissors } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { locationName, STOCK_UNIT_LABELS, stockUnit, type Location, type Product, type Roll } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { CartonHint } from "@/components/quantity/carton-hint";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import type { StockHold } from "@/lib/api/contract";

/**
 * Ready to cut (audit U-22): reserved stock whose invoice has confirmed money in, so it may be cut
 * or issued now. Warehouse staff do not see the Sales menu, so this list is where their paid work
 * shows up; the store gives just the invoice number, customer and quantity.
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
  const [pending, setPending] = useState<string | null>(null);
  const rows = holds.filter(
    (h) => h.mayIssue && Number(h.quantity) > 0 && (!warehouseId || h.locationId === warehouseId),
  );
  const product = (h: StockHold) => products.find((p) => p.id === h.productId);
  const unit = (h: StockHold) => {
    const p = product(h);
    return STOCK_UNIT_LABELS[(p && stockUnit(p)) || "each"];
  };

  function issue(hold: StockHold) {
    setPending(hold.reservationId);
    api
      .issueReservation(hold.reservationId)
      .then(() => toast.success(`${hold.rollId ? "Cut" : "Issued"} for ${hold.invoiceNumber}`))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Not saved."))
      .finally(() => setPending(null));
  }

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
          <Button size="sm" disabled={pending === h.reservationId} onClick={() => issue(h)}>
            <Scissors />
            {h.rollId ? "Cut" : "Issue"}
          </Button>
        ) : null,
    },
  ];
  return (
    <DataTable
      id="inventory-ready"
      rows={rows}
      columns={columns}
      getRowId={(h) => h.reservationId}
      searchPlaceholder="Search invoices and customers"
      empty={{ message: "Nothing is ready to cut. Paid invoices with reserved stock appear here." }}
    />
  );
}
