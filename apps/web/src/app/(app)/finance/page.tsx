import type { Metadata } from "next";
import { Suspense } from "react";
import { FinancePage } from "@/features/finance/finance-page";

export const metadata: Metadata = { title: "Finance" };

/** Finance: payments to verify and expenses. */
export default function Page() {
  return (
    <Suspense>
      <FinancePage />
    </Suspense>
  );
}
