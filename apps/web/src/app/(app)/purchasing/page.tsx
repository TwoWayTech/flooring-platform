import type { Metadata } from "next";
import { Suspense } from "react";
import { PurchasingPage } from "@/features/purchasing/purchasing-page";

export const metadata: Metadata = { title: "Purchasing" };

/** Purchasing: suppliers, purchase orders, bills and payables. */
export default function Page() {
  return (
    <Suspense>
      <PurchasingPage />
    </Suspense>
  );
}
