import type { Metadata } from "next";
import { Suspense } from "react";
import { ReportsPage } from "@/features/reports/reports-page";

export const metadata: Metadata = { title: "Reports" };

/** The reports hub. */
export default function Page() {
  return (
    <Suspense>
      <ReportsPage />
    </Suspense>
  );
}
