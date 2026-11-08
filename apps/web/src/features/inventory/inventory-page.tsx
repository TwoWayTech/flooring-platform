"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { featureOn } from "@workspace/shared";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { QueryFallback } from "@/components/query-fallback";
import { useApiQuery } from "@/lib/api/use-api";
import { useCan } from "@/components/workspace/workspace-context";
import { NoAccess } from "@/components/no-access";
import { ALL_WAREHOUSES, ALL_WAREHOUSES_OPTION, WarehouseSelect } from "@/components/warehouse-select";
import { ProductsTable } from "./products-table";
import { RollsTable } from "./rolls-table";
import { TransfersPanel } from "./transfers/transfers-panel";

type InventoryView = "products" | "rolls" | "transfers";

/**
 * Inventory (spec "Inventory and roll detail", A1): products and rolls, filterable by warehouse,
 * with mini roll gauges, and transfers between warehouses.
 */
export function InventoryPage() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const data = useApiQuery(async (client) => {
    const [products, rolls, stockMovements, locations, transfers, users] = await Promise.all([
      client.list("products"),
      client.list("rolls"),
      client.list("stockMovements"),
      client.list("locations"),
      client.list("transfers"),
      client.list("users"),
    ]);
    return { products, rolls, stockMovements, locations, transfers, users };
  }, []);
  const allowed: Record<InventoryView, boolean> = {
    products: can("inventory.product.view") && featureOn("inventory.products"),
    rolls: can("inventory.roll.view") && featureOn("inventory.rolls"),
    transfers: can("inventory.transfer.view") && featureOn("inventory.transfers"),
  };
  const views = (Object.keys(allowed) as InventoryView[]).filter((v) => allowed[v]);
  if (views.length === 0) return <NoAccess />;
  const asked = params.get("view") as InventoryView | null;
  const view = asked && allowed[asked] ? asked : views[0]!;
  const warehouse = params.get("warehouse") ?? ALL_WAREHOUSES;
  const warehouseId = warehouse === ALL_WAREHOUSES ? null : warehouse;

  /** Keeps the other query values (filters) and changes one. */
  function navigate(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    router.replace(`/inventory?${next.toString()}`);
  }

  return (
    <>
      <PageHeader title="Inventory" />
      <Tabs
        value={view}
        className="gap-6"
        onValueChange={(v) => {
          const next = new URLSearchParams(params.get("warehouse") ? { warehouse } : {});
          next.set("view", v);
          router.replace(`/inventory?${next.toString()}`);
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList aria-label="Inventory view">
            {allowed.products ? <TabsTrigger value="products">Products</TabsTrigger> : null}
            {allowed.rolls ? <TabsTrigger value="rolls">Rolls and remnants</TabsTrigger> : null}
            {allowed.transfers ? <TabsTrigger value="transfers">Transfers</TabsTrigger> : null}
          </TabsList>
          {view !== "transfers" && data.status === "ready" ? (
            <WarehouseSelect
              label="Warehouse"
              extraOption={ALL_WAREHOUSES_OPTION}
              locations={data.data.locations}
              value={warehouse}
              onChange={(v) => navigate("warehouse", v === ALL_WAREHOUSES ? null : v)}
            />
          ) : null}
        </div>
        <TabsContent value={view} className="flex flex-col gap-6">
          {data.status !== "ready" ? (
            <QueryFallback query={data} className="h-96" label="Loading inventory" />
          ) : view === "transfers" ? (
            <TransfersPanel {...data.data} />
          ) : view === "rolls" ? (
            <RollsTable
              rolls={data.data.rolls}
              products={data.data.products}
              locations={data.data.locations}
              warehouseId={warehouseId}
            />
          ) : (
            <ProductsTable
              products={data.data.products}
              rolls={data.data.rolls}
              movements={data.data.stockMovements}
              locations={data.data.locations}
              warehouseId={warehouseId}
            />
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
