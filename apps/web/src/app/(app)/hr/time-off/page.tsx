import type { Metadata } from "next";
import { TimeOffPage } from "@/features/hr/time-off-page";

export const metadata: Metadata = { title: "Time off" };

/** Time off. */
export default function Page() {
  return <TimeOffPage />;
}
