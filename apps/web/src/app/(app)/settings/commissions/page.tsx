import type { Metadata } from "next";
import { CommissionsPage } from "@/features/settings/commissions/commissions-page";

export const metadata: Metadata = { title: "Commissions" };

/** Settings: Commissions. */
export default function Page() {
  return <CommissionsPage />;
}
