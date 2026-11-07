import type { Metadata } from "next";
import { RolesPage } from "@/features/settings/roles/roles-page";

export const metadata: Metadata = { title: "Security roles" };

/** Settings: Security roles. */
export default function Page() {
  return <RolesPage />;
}
