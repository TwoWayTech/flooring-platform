import type { Metadata } from "next";
import { CommissionsPage } from "@/features/hr/commissions/commissions-page";

export const metadata: Metadata = { title: "Commissions" };

/** Commissions. */
export default function Page() {
  return <CommissionsPage />;
}
