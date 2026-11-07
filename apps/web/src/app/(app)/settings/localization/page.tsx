import type { Metadata } from "next";
import { Suspense } from "react";
import { LocalizationPage } from "@/features/settings/localization/localization-page";

export const metadata: Metadata = { title: "Localization and tax" };

/** Settings: Localization and tax. */
export default function Page() {
  return (
    <Suspense>
      <LocalizationPage />
    </Suspense>
  );
}
