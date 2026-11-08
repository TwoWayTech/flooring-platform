"use client";

import { useState } from "react";
import { Plus, Store, Warehouse } from "lucide-react";
import type { Location } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { PageHeader } from "@workspace/ui/components/page-header";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { useApiQuery } from "@/lib/api/use-api";
import { LocationDialog } from "./location-dialog";

/**
 * Settings: Warehouses and showrooms (spec A1). Warehouses hold sellable stock and ship to
 * customers; showrooms only display samples (plan A-1). One warehouse is the company default.
 */
export function LocationsPage() {
  const can = useCan();
  const { company } = useWorkspace();
  const [editing, setEditing] = useState<Location | "new" | null>(null);
  const data = useApiQuery((client) => client.list("locations"), []);
  if (!can("settings.locations.manage")) return <NoAccess />;

  const branchName = (id: string) => company.branches.find((b) => b.id === id)?.name ?? "";
  const columns: ColumnSpec<Location>[] = [
    {
      id: "name",
      header: "Name",
      value: (l) => l.name,
      cell: (l) => <span className="font-medium">{l.name}</span>,
    },
    {
      id: "kind",
      header: "Type",
      value: (l) => (l.kind === "warehouse" ? "Warehouse" : "Showroom"),
      cell: (l) =>
        l.kind === "warehouse" ? (
          <StatusPill tone="brand" icon={Warehouse} label="Warehouse" />
        ) : (
          <StatusPill tone="neutral" icon={Store} label="Showroom" />
        ),
    },
    { id: "branch", header: "Branch", value: (l) => branchName(l.branchId) },
    { id: "city", header: "City", value: (l) => `${l.address.city}, ${l.address.state}` },
    {
      id: "samples",
      header: "Display samples",
      kind: "count",
      value: (l) => (l.kind === "showroom" ? l.displaySamples : null),
    },
    { id: "default", header: "Company default", value: (l) => (l.isDefault ? "Default" : "") },
  ];

  return (
    <>
      <PageHeader
        title="Warehouses and showrooms"
        description="Where your stock is kept and shown. New quotes, invoices and orders start from a person's own default warehouse, then the company default."
      />
      {data.status !== "ready" ? (
        <QueryFallback query={data} className="h-64" label="Loading locations" />
      ) : (
        <DataTable
          id="settings-locations"
          rows={data.data}
          columns={columns}
          getRowId={(l) => l.id}
          onRowClick={setEditing}
          rowLabel={(l) => `Edit ${l.name}`}
          searchPlaceholder="Search locations"
          empty={{ message: "No warehouses or showrooms yet." }}
          toolbar={
            <Button size="sm" className="h-9" onClick={() => setEditing("new")}>
              <Plus />
              Add location
            </Button>
          }
        />
      )}
      {editing ? (
        <LocationDialog
          location={editing === "new" ? null : editing}
          branches={company.branches}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
