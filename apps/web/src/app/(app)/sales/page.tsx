import type { Metadata } from "next";
import { Suspense } from "react";
import { SalesPage } from "@/features/sales/sales-page";

export const metadata: Metadata = { title: "Sales" };

/** Sales: quotes and invoices. */
export default function Page() {
  return (
    <Suspense>
      <SalesPage />
    </Suspense>
  );
}
