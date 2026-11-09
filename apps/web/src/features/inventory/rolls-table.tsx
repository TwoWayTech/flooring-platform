"use client";

import { useRouter } from "next/navigation";
import { Scissors, Truck, TriangleAlert } from "lucide-react";
import {
  locationName,
  reservedOnRoll,
  rollAvailable,
  SENSITIVE,
  type Location,
  type Product,
  type Reservation,
  type Roll,
} from "@workspace/shared";
import { RollGauge } from "@workspace/ui/components/roll-gauge";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { Swatch } from "@workspace/ui/components/swatch";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { useCan } from "@/components/workspace/workspace-context";
import { LOW_ROLL_FT } from "@/lib/attention";
import { rollSqYd } from "./stock";

/** What a roll is today, for the Type column and its filter: Low is a full roll under LOW_ROLL_FT. */
function rollType(roll: Roll): "In transit" | "Remnant" | "Used up" | "Low" | "Roll" {
  const left = Number(roll.remainingLengthFt);
  if (roll.transferId) return "In transit";
  if (roll.isRemnant) return "Remnant";
  if (left === 0) return "Used up";
  return left < LOW_ROLL_FT ? "Low" : "Roll";
}

interface RollsTableProps {
  /** Invoices' holds on the rolls, for Reserved and Available (spec C2). */
  reservations: Reservation[];
  rolls: Roll[];
  products: Product[];
  locations: Location[];
  /** Only rolls at this warehouse, or every roll when null (spec A1 warehouse filter). */
  warehouseId: string | null;
}

/** The roll list with mini roll gauges (spec "Inventory"); a row opens the roll page. */
export function RollsTable({ rolls, products, locations, warehouseId, reservations }: RollsTableProps) {
  const can = useCan();
  const router = useRouter();
  const productOf = (roll: Roll) => products.find((p) => p.id === roll.productId);

  const columns: ColumnSpec<Roll>[] = [
    {
      id: "roll",
      header: "Roll",
      value: (r) => r.rollNumber,
      cell: (r) => <span className="font-medium">{r.rollNumber}</span>,
    },
    {
      id: "product",
      header: "Product",
      value: (r) => productOf(r)?.name ?? "",
      cell: (r) => {
        const p = productOf(r);
        return p ? (
          <span className="flex items-center gap-2">
            <Swatch color={p.swatch} label={p.colorName} />
            {p.name}
          </span>
        ) : null;
      },
    },
    { id: "dyeLot", header: "Dye lot", value: (r) => r.dyeLot },
    {
      id: "gauge",
      header: "Length left",
      visualOnly: true,
      value: () => null,
      cell: (r) => (
        <RollGauge
          size="mini"
          originalFt={Number(r.originalLengthFt)}
          remainingFt={Number(r.remainingLengthFt)}
          cutsFt={r.cuts.map((c) => Number(c.lengthFt))}
          label={`${r.remainingLengthFt} ft of ${r.originalLengthFt} ft left`}
          className="w-24"
        />
      ),
    },
    { id: "remaining", header: "Remaining", kind: "quantity", unit: "ft", value: (r) => r.remainingLengthFt },
    {
      id: "reserved",
      header: "Reserved",
      kind: "quantity",
      unit: "ft",
      value: (r) => reservedOnRoll(r.id, reservations).toString(),
    },
    {
      id: "available",
      header: "Available",
      kind: "quantity",
      unit: "ft",
      value: (r) => rollAvailable(r, reservations).toString(),
    },
    {
      id: "original",
      header: "Original",
      kind: "quantity",
      unit: "ft",
      value: (r) => r.originalLengthFt,
      hidden: true,
    },
    { id: "width", header: "Width", kind: "quantity", unit: "ft", value: (r) => r.widthFt },
    { id: "area", header: "Area", kind: "quantity", unit: "sq yd", value: (r) => rollSqYd(r) },
    // The page's warehouse filter applies to every inventory tab, so this column has none of its own.
    { id: "warehouse", header: "Warehouse", value: (r) => locationName(locations, r.locationId), filter: false },
    { id: "bin", header: "Bin", value: (r) => r.bin },
    ...(can(SENSITIVE.productCost)
      ? [{ id: "cost", header: "Cost per sq ft", kind: "unitCost" as const, value: (r: Roll) => r.costPerSqFt }]
      : []),
    {
      id: "type",
      header: "Type",
      filter: "select",
      value: rollType,
      cell: (r) => {
        const type = rollType(r);
        if (type === "In transit") return <StatusPill tone="brand" icon={Truck} label={type} />;
        if (type === "Remnant") return <StatusPill tone="neutral" icon={Scissors} label={type} />;
        if (type === "Low") return <StatusPill tone="warning" icon={TriangleAlert} label={type} />;
        return type === "Used up" ? <span className="text-muted-foreground">{type}</span> : type;
      },
    },
  ];

  return (
    <DataTable
      id="inventory-rolls"
      rows={rolls.filter((r) => !warehouseId || r.locationId === warehouseId)}
      columns={columns}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(`/inventory/rolls/${r.id}`)}
      rowLabel={(r) => `Open roll ${r.rollNumber}`}
      searchPlaceholder="Search rolls, products, dye lots"
      csvName="rolls"
      empty={{ message: "No rolls at this warehouse." }}
      initialSort={{ id: "remaining", desc: false }}
    />
  );
}
