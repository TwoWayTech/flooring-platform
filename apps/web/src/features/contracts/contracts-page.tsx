"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, TriangleAlert } from "lucide-react";
import { contractDisplayStatus, contractFigures, pastEndDate, type Contract } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { PageHeader } from "@workspace/ui/components/page-header";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { ContractFormDialog } from "./contract-form-dialog";
import { CONTRACT_STATUS } from "./contract-status";

/** The contract list (spec D2): filter by type, company, status, value and end date. */
export function ContractsPage() {
  const can = useCan();
  const router = useRouter();
  const formatDate = useFormatDate();
  const [adding, setAdding] = useState(false);
  const data = useApiQuery(async (client) => {
    const [contracts, lines, billings, orders, customers, suppliers, locations] = await Promise.all([
      client.list("contracts"),
      client.list("contractLines"),
      client.list("contractBillings"),
      client.list("changeOrders"),
      client.list("customers"),
      client.list("suppliers"),
      client.list("locations"),
    ]);
    return { contracts, lines, billings, orders, customers, suppliers, locations };
  }, []);
  if (!can("contracts.contract.view")) return <NoAccess />;
  const today = api.today();
  const partyOf = (c: Contract) =>
    (c.customerId
      ? data.data?.customers.find((x) => x.id === c.customerId)?.name
      : data.data?.suppliers.find((x) => x.id === c.supplierId)?.name) ?? "Unknown";
  const figures = (c: Contract) =>
    data.data ? contractFigures(c, data.data.lines, data.data.billings, data.data.orders) : null;
  const columns: ColumnSpec<Contract>[] = [
    {
      id: "number",
      header: "Number",
      value: (c) => c.number,
      cell: (c) => <span className="font-medium">{c.number}</span>,
    },
    { id: "title", header: "Title", value: (c) => c.title },
    { id: "company", header: "Company", value: partyOf },
    { id: "type", header: "Type", value: (c) => (c.direction === "customer" ? "Customer" : "Subcontractor") },
    { id: "kind", header: "Kind", value: (c) => (c.kind === "master" ? "Master" : "Project"), hidden: true },
    {
      id: "status",
      header: "Status",
      value: (c) => CONTRACT_STATUS[contractDisplayStatus(c, today)].label,
      cell: (c) => (
        <span className="flex items-center gap-1.5">
          <StatusPill {...CONTRACT_STATUS[contractDisplayStatus(c, today)]} />
          {pastEndDate(c, today) ? (
            <TriangleAlert aria-label="Past end date" className="text-warning-ink size-4" />
          ) : null}
        </span>
      ),
    },
    { id: "value", header: "Value", kind: "money", value: (c) => figures(c)?.value ?? "0", total: true },
    { id: "held", header: "Retained", kind: "money", value: (c) => figures(c)?.held ?? "0", total: true },
    { id: "end", header: "End date", value: (c) => c.endsAt, cell: (c) => formatDate(c.endsAt) },
  ];

  return (
    <>
      <PageHeader
        title="Contracts"
        actions={
          can("contracts.contract.create") ? (
            <Button onClick={() => setAdding(true)}>
              <Plus />
              New contract
            </Button>
          ) : null
        }
      />
      {data.status !== "ready" ? (
        <QueryFallback query={data} className="h-96" label="Loading contracts" />
      ) : (
        <DataTable
          id="contracts"
          rows={data.data.contracts}
          columns={columns}
          getRowId={(c) => c.id}
          onRowClick={(c) => router.push(`/contracts/${c.id}`)}
          rowLabel={(c) => `Open ${c.number}`}
          searchPlaceholder="Search contracts"
          csvName="contracts"
          initialSort={{ id: "number", desc: true }}
          empty={{ message: "No contracts yet." }}
        />
      )}
      {adding && data.data ? (
        <ContractFormDialog
          contract={null}
          lines={[]}
          customers={data.data.customers}
          suppliers={data.data.suppliers}
          locations={data.data.locations}
          onClose={() => setAdding(false)}
          onSaved={(id) => router.push(`/contracts/${id}`)}
        />
      ) : null}
    </>
  );
}
