import type { Metadata } from "next";
import { SettingsImportPage } from "@/features/import/settings-import-page";

export const metadata: Metadata = { title: "Data import" };

/** Settings: Data import (spec G1). */
export default function Page() {
  return <SettingsImportPage />;
}
