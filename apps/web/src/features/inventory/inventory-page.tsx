"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { QueryFallback } from "@/components/query-fallback";
import { useApiQuery } from "@/lib/api/use-api";
import { useCan } from "@/components/workspace/workspace-context";
import { NoAccess } from "@/components/no-access";
import { ProductsTable } from "./products-table";
import { RollsTable } from "./rolls-table";

/** Inventory (spec "Inventory and roll detail"): products and rolls, filterable, with mini roll gauges. */
export function InventoryPage() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const data = useApiQuery(async (client) => {
    const [products, rolls] = await Promise.all([client.list("products"), client.list("rolls")]);
    return { products, rolls };
  }, []);
  const canProducts = can("inventory.product.view");
  const canRolls = can("inventory.roll.view");
  if (!canProducts && !canRolls) return <NoAccess />;
  const view = params.get("view") === "rolls" || !canProducts ? "rolls" : "products";

  return (
    <>
      <PageHeader title="Inventory" />
      <Tabs value={view} className="gap-6" onValueChange={(v) => router.replace(`/inventory?view=${v}`)}>
        <TabsList aria-label="Inventory view">
          {canProducts ? <TabsTrigger value="products">Products</TabsTrigger> : null}
          {canRolls ? <TabsTrigger value="rolls">Rolls and remnants</TabsTrigger> : null}
        </TabsList>
        <TabsContent value={view} className="flex flex-col gap-6">
          {data.status !== "ready" ? (
            <QueryFallback query={data} className="h-96" label="Loading inventory" />
          ) : view === "rolls" ? (
            <RollsTable rolls={data.data.rolls} products={data.data.products} />
          ) : (
            <ProductsTable products={data.data.products} rolls={data.data.rolls} />
          )}
        </TabsContent>
      </Tabs>
    </>
  );
}
