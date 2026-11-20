"use client";

import { useState } from "react";
import { Plus, Store, Warehouse } from "lucide-react";
import type { Location } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useCan } from "@/components/workspace/workspace-context";
import { useApiQuery } from "@/lib/api/use-api";
import { LocationDialog } from "./location-dialog";
import { StockRulesForm } from "./stock-rules-form";
import { Panel } from "@workspace/ui/components/panel";

/**
 * Settings: Warehouses and showrooms (spec A1). Warehouses hold sellable stock and ship to
 * customers; showrooms only display samples (plan A-1). One warehouse is the company default.
 * The stock rules below say when an adjustment needs approval (spec C1).
 */
export function LocationsPage() {
  const can = useCan();
  const [editing, setEditing] = useState<Location | "new" | null>(null);
  // Branches from the same source as the locations: DemoStore's in api mode until Locations moves,
  // since the shell's branches are the API's since GET /company (ADR 0051, "GET /company", D7).
  const data = useApiQuery(async (client) => {
    const [locations, company] = await Promise.all([client.list("locations"), client.getCompany()]);
    return { locations, branches: company.branches };
  }, []);
  if (!can("settings.locations.manage")) return <NoAccess />;

  const branches = data.data?.branches ?? [];
  const branchName = (id: string) => branches.find((b) => b.id === id)?.name ?? "";
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
      <p className="text-muted-foreground max-w-prose text-sm">
        New quotes, invoices and orders start from a person&apos;s own default warehouse, then the company default.
      </p>
      {data.status !== "ready" ? (
        <QueryFallback query={data} className="h-64" label="Loading locations" />
      ) : (
        <DataTable
          id="settings-locations"
          rows={data.data.locations}
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
      <Panel bodyClassName="flex flex-col gap-8">
        <StockRulesForm />
      </Panel>
      {editing ? (
        <LocationDialog
          location={editing === "new" ? null : editing}
          branches={branches}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
