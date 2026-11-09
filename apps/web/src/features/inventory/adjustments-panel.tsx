"use client";

import { useState } from "react";
import { CircleCheck, ScanSearch, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  ADJUSTMENT_REASON_LABELS,
  locationName,
  stockUnit,
  type Location,
  type Product,
  type Roll,
  type StockAdjustment,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { ReasonDialog } from "@/components/reason-dialog";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useFormatDate } from "@/lib/use-format-date";

const STATUS = {
  pending: { tone: "warning", icon: ScanSearch, label: "Waits for approval" },
  approved: { tone: "success", icon: CircleCheck, label: "Applied" },
  rejected: { tone: "neutral", icon: XCircle, label: "Rejected" },
} as const;

/**
 * Stock adjustments (spec C1): every change without a sale, a receipt or a transfer, with its
 * reason. Owners and Managers approve or reject the ones above the company's limit; never their own.
 */
export function AdjustmentsPanel({
  adjustments,
  products,
  rolls,
  locations,
}: {
  adjustments: StockAdjustment[];
  products: Product[];
  rolls: Roll[];
  locations: Location[];
}) {
  const can = useCan();
  const { user } = useWorkspace();
  const formatDate = useFormatDate();
  const [rejecting, setRejecting] = useState<StockAdjustment | null>(null);
  const product = (a: StockAdjustment) => products.find((p) => p.id === a.productId);
  const unit = (a: StockAdjustment) => {
    const p = product(a);
    return (p && stockUnit(p)) || "each";
  };
  const approve = (a: StockAdjustment) =>
    api
      .reviewAdjustment(a.id, { action: "approve" })
      .then(() => toast.success(`${a.number} approved and applied`))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Not saved."));

  const columns: ColumnSpec<StockAdjustment>[] = [
    {
      id: "number",
      header: "Adjustment",
      value: (a) => a.number,
      cell: (a) => <span className="font-medium">{a.number}</span>,
    },
    { id: "at", header: "Date", value: (a) => a.requestedAt, cell: (a) => formatDate(a.requestedAt.slice(0, 10)) },
    {
      id: "item",
      header: "Item",
      value: (a) => {
        const roll = rolls.find((r) => r.id === a.rollId);
        return `${product(a)?.name ?? ""}${roll ? `, roll ${roll.rollNumber}` : ""}`;
      },
    },
    { id: "warehouse", header: "Warehouse", value: (a) => locationName(locations, a.locationId) },
    {
      id: "quantity",
      header: "Change",
      kind: "quantity",
      value: (a) => a.quantity,
      cell: (a) => <Num kind="quantity" value={a.quantity} unit={unit(a)} />,
    },
    { id: "reason", header: "Reason", value: (a) => ADJUSTMENT_REASON_LABELS[a.reason] },
    { id: "note", header: "Note", value: (a) => a.note || null },
    { id: "by", header: "Requested by", value: (a) => a.requestedBy },
    {
      id: "status",
      header: "Status",
      value: (a) => STATUS[a.status].label,
      cell: (a) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          <StatusPill {...STATUS[a.status]} />
          {a.status === "pending" && can("inventory.stock.approve") && a.requestedById !== user.id ? (
            <>
              <Button
                size="sm"
                aria-label={`Approve ${a.number}`}
                onClick={(e) => (e.stopPropagation(), void approve(a))}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-label={`Reject ${a.number}`}
                onClick={(e) => (e.stopPropagation(), setRejecting(a))}
              >
                Reject
              </Button>
            </>
          ) : null}
        </span>
      ),
    },
  ];
  return (
    <>
      <DataTable
        id="inventory-adjustments"
        rows={adjustments}
        columns={columns}
        getRowId={(a) => a.id}
        searchPlaceholder="Search adjustments"
        csvName="stock-adjustments"
        initialSort={{ id: "at", desc: true }}
        empty={{ message: "No stock adjustments yet. Record one from a product or a roll." }}
      />
      {rejecting ? (
        <ReasonDialog
          title={`Reject ${rejecting.number}`}
          description="The stock stays as it is. The reason goes to the audit log."
          confirmLabel="Reject adjustment"
          destructive
          onConfirm={(reason) => api.reviewAdjustment(rejecting.id, { action: "reject", reason })}
          onClose={() => setRejecting(null)}
        />
      ) : null}
    </>
  );
}
