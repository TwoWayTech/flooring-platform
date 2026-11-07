import type { Metadata } from "next";
import { HrDashboard } from "@/features/hr/hr-dashboard";

export const metadata: Metadata = { title: "HR" };

/** HR. */
export default function Page() {
  return <HrDashboard />;
}
