import type { Metadata } from "next";
import { MyTimesheetPage } from "@/features/my/my-timesheet";

export const metadata: Metadata = { title: "My timesheet" };

/** My timesheet. */
export default function Page() {
  return <MyTimesheetPage />;
}
