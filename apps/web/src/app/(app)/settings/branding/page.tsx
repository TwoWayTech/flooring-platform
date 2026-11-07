import type { Metadata } from "next";
import { BrandingPage } from "@/features/settings/branding/branding-page";

export const metadata: Metadata = { title: "Branding" };

/** Settings: Branding. */
export default function Page() {
  return <BrandingPage />;
}
