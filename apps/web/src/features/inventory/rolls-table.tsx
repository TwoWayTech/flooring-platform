"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Scissors, TriangleAlert } from "lucide-react";
import { SENSITIVE, type Product, type Roll } from "@workspace/shared";
import { RollGauge } from "@workspace/ui/components/roll-gauge";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { Swatch } from "@workspace/ui/components/swatch";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { useCan } from "@/components/workspace/workspace-context";
import { LOW_ROLL_FT } from "@/lib/attention";
import { rollSqYd } from "./stock";

const FILTERS = { all: "All", full: "Full rolls", remnants: "Remnants", low: `Under ${LOW_ROLL_FT} ft` } as const;
type RollFilter = keyof typeof FILTERS;

/** Rolls matching a list filter; used-up rolls are hidden except from "All". */
function matches(roll: Roll, filter: RollFilter): boolean {
  const left = Number(roll.remainingLengthFt);
  if (filter === "full") return !roll.isRemnant && left > 0;
  if (filter === "remnants") return roll.isRemnant && left > 0;
  if (filter === "low") return !roll.isRemnant && left > 0 && left < LOW_ROLL_FT;
  return true;
}

/** The roll list with mini roll gauges (spec "Inventory"); a row opens the roll page. */
export function RollsTable({ rolls, products }: { rolls: Roll[]; products: Product[] }) {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const filter = (params.get("filter") as RollFilter) in FILTERS ? (params.get("filter") as RollFilter) : "all";
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
      id: "original",
      header: "Original",
      kind: "quantity",
      unit: "ft",
      value: (r) => r.originalLengthFt,
      hidden: true,
    },
    { id: "width", header: "Width", kind: "quantity", unit: "ft", value: (r) => r.widthFt },
    { id: "area", header: "Area", kind: "quantity", unit: "sq yd", value: (r) => rollSqYd(r) },
    { id: "location", header: "Location", value: (r) => `${r.warehouse}, bin ${r.bin}` },
    ...(can(SENSITIVE.productCost)
      ? [{ id: "cost", header: "Cost per sq ft", kind: "unitCost" as const, value: (r: Roll) => r.costPerSqFt }]
      : []),
    {
      id: "type",
      header: "Type",
      value: (r) => (r.isRemnant ? "Remnant" : "Roll"),
      cell: (r) => {
        const left = Number(r.remainingLengthFt);
        if (r.isRemnant) return <StatusPill tone="neutral" icon={Scissors} label="Remnant" />;
        if (left > 0 && left < LOW_ROLL_FT) return <StatusPill tone="warning" icon={TriangleAlert} label="Low" />;
        return left === 0 ? <span className="text-muted-foreground">Used up</span> : "Roll";
      },
    },
  ];

  return (
    <DataTable
      id="inventory-rolls"
      rows={rolls.filter((r) => matches(r, filter))}
      columns={columns}
      getRowId={(r) => r.id}
      onRowClick={(r) => router.push(`/inventory/rolls/${r.id}`)}
      rowLabel={(r) => `Open roll ${r.rollNumber}`}
      searchPlaceholder="Search rolls, products, dye lots"
      csvName="rolls"
      empty={{ message: "No rolls match this filter." }}
      initialSort={{ id: "remaining", desc: false }}
      toolbar={
        <Tabs value={filter} onValueChange={(v) => router.replace(`/inventory?view=rolls&filter=${v}`)}>
          <TabsList aria-label="Show">
            {(Object.keys(FILTERS) as RollFilter[]).map((key) => (
              <TabsTrigger key={key} value={key}>
                {FILTERS[key]}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      }
    />
  );
}
