import type { Metadata } from "next";
import { Suspense } from "react";
import { InventoryPage } from "@/features/inventory/inventory-page";

export const metadata: Metadata = { title: "Inventory" };

/** Inventory: products, rolls and remnants. */
export default function Page() {
  return (
    <Suspense>
      <InventoryPage />
    </Suspense>
  );
}
