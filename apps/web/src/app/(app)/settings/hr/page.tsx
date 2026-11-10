import type { Metadata } from "next";
import { HrSettingsPage } from "@/features/settings/hr/hr-settings-page";

export const metadata: Metadata = { title: "HR settings" };

/** HR settings. */
export default function Page() {
  return <HrSettingsPage />;
}
