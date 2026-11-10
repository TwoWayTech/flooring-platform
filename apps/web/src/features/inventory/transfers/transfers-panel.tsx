"use client";

import { useState } from "react";
import { CircleCheck, PackageCheck, Plus, Truck } from "lucide-react";
import { toast } from "sonner";
import {
  locationName,
  type Location,
  type Product,
  type Roll,
  type StockMovement,
  type Transfer,
  type User,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useFormatDate } from "@/lib/use-format-date";
import { NewTransferDialog } from "./new-transfer-dialog";

interface TransfersPanelProps {
  transfers: Transfer[];
  locations: Location[];
  products: Product[];
  rolls: Roll[];
  stockMovements: StockMovement[];
  users: User[];
}

/** What a transfer carries, in words: "283.68 sq ft of Harbor Oak, roll NM-4471". */
function itemsOf(transfer: Transfer, products: readonly Product[], rolls: readonly Roll[]): string {
  return transfer.lines
    .map((line) => {
      if (line.rollId) return `roll ${rolls.find((r) => r.id === line.rollId)?.rollNumber ?? ""}`.trim();
      const product = products.find((p) => p.id === line.productId);
      const unit = product?.sqFtPerCarton ? " sq ft of " : " × ";
      return `${line.quantity}${unit}${product?.name ?? "item"}`;
    })
    .join(", ");
}

/**
 * Transfers between warehouses (spec A1): what left where, what is still in transit, and a
 * Receive button for the receiving warehouse.
 */
export function TransfersPanel({ transfers, locations, products, rolls, stockMovements, users }: TransfersPanelProps) {
  const can = useCan();
  const formatDate = useFormatDate();
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<string | null>(null);

  async function receive(transfer: Transfer) {
    setPending(transfer.id);
    try {
      await api.receiveTransfer(transfer.id);
      toast.success(`${transfer.number} received at ${locationName(locations, transfer.toId)}`);
    } finally {
      setPending(null);
    }
  }

  const columns: ColumnSpec<Transfer>[] = [
    {
      id: "number",
      header: "Transfer",
      value: (t) => t.number,
      cell: (t) => <span className="font-medium">{t.number}</span>,
    },
    { id: "from", header: "From", value: (t) => locationName(locations, t.fromId) },
    { id: "to", header: "To", value: (t) => locationName(locations, t.toId) },
    { id: "items", header: "Items", value: (t) => itemsOf(t, products, rolls), className: "max-w-80 truncate" },
    { id: "sent", header: "Sent", value: (t) => t.createdAt, cell: (t) => formatDate(t.createdAt.slice(0, 10)) },
    {
      id: "by",
      header: "Sent by",
      value: (t) => users.find((u) => u.id === t.createdBy)?.name ?? "",
      hidden: true,
    },
    {
      id: "status",
      header: "Status",
      value: (t) => (t.status === "received" ? "Received" : "In transit"),
      cell: (t) =>
        t.status === "received" ? (
          <StatusPill tone="success" icon={CircleCheck} label="Received" />
        ) : (
          <StatusPill tone="brand" icon={Truck} label="In transit" />
        ),
    },
    {
      id: "action",
      header: "Action",
      visualOnly: true,
      value: () => null,
      cell: (t) =>
        t.status === "in_transit" && can("inventory.transfer.receive") ? (
          <Button size="sm" variant="outline" disabled={pending === t.id} onClick={() => void receive(t)}>
            <PackageCheck />
            Receive
          </Button>
        ) : t.receivedAt ? (
          <span className="text-muted-foreground text-xs">{formatDate(t.receivedAt.slice(0, 10))}</span>
        ) : null,
    },
  ];

  return (
    <>
      <DataTable
        id="inventory-transfers"
        rows={transfers}
        columns={columns}
        getRowId={(t) => t.id}
        searchPlaceholder="Search transfers and items"
        csvName="transfers"
        initialSort={{ id: "sent", desc: true }}
        empty={{ message: "No transfers yet." }}
        toolbar={
          can("inventory.transfer.create") ? (
            <Button size="sm" className="h-9" onClick={() => setCreating(true)}>
              <Plus />
              New transfer
            </Button>
          ) : null
        }
      />
      {creating ? (
        <NewTransferDialog
          open
          onOpenChange={setCreating}
          locations={locations}
          products={products}
          rolls={rolls}
          movements={stockMovements}
        />
      ) : null}
    </>
  );
}
