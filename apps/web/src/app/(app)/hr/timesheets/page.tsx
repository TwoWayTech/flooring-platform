import type { Metadata } from "next";
import { TimesheetsPage } from "@/features/hr/timesheets-page";

export const metadata: Metadata = { title: "Timesheets" };

/** Timesheets. */
export default function Page() {
  return <TimesheetsPage />;
}
