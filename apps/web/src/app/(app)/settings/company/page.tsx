import type { Metadata } from "next";
import { CompanyProfilePage } from "@/features/settings/company-profile-page";

export const metadata: Metadata = { title: "Company profile" };

/** Settings: Company profile. */
export default function Page() {
  return <CompanyProfilePage />;
}
