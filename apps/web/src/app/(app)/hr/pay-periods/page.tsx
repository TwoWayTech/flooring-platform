import type { Metadata } from "next";
import { PayPeriodsPage } from "@/features/hr/pay-periods-page";

export const metadata: Metadata = { title: "Pay periods" };

/** Pay periods. */
export default function Page() {
  return <PayPeriodsPage />;
}
