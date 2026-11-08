import type { Metadata } from "next";
import { LocationsPage } from "@/features/settings/locations/locations-page";

export const metadata: Metadata = { title: "Warehouses and showrooms" };

/** Settings: Warehouses and showrooms. */
export default function Page() {
  return <LocationsPage />;
}
