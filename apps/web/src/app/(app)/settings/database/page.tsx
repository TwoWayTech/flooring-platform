import type { Metadata } from "next";
import { SettingsDatabasePage } from "@/features/import/settings-database-page";

export const metadata: Metadata = { title: "Connect a database" };

/** Settings: Connect a database (spec G2). */
export default function Page() {
  return <SettingsDatabasePage />;
}
