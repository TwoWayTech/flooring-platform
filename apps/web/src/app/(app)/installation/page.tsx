import type { Metadata } from "next";
import { Suspense } from "react";
import { InstallationPage } from "@/features/installation/installation-page";

export const metadata: Metadata = { title: "Installation" };

/** Installation: the crew calendar and job cards. */
export default function Page() {
  return (
    <Suspense>
      <InstallationPage />
    </Suspense>
  );
}
