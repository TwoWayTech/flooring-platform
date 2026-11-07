"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
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
      <Tabs value={view} onValueChange={(v) => router.replace(`/inventory?view=${v}`)}>
        <TabsList aria-label="Inventory view">
          {canProducts ? <TabsTrigger value="products">Products</TabsTrigger> : null}
          {canRolls ? <TabsTrigger value="rolls">Rolls and remnants</TabsTrigger> : null}
        </TabsList>
      </Tabs>
      {data.status !== "ready" ? (
        <Skeleton className="h-96" aria-label="Loading inventory" />
      ) : view === "rolls" ? (
        <RollsTable rolls={data.data.rolls} products={data.data.products} />
      ) : (
        <ProductsTable products={data.data.products} rolls={data.data.rolls} />
      )}
    </>
  );
}
