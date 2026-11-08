import type { Metadata } from "next";
import { DocumentsPage } from "@/features/settings/documents/documents-page";

export const metadata: Metadata = { title: "Sales and documents" };

/** Settings: Sales and documents. */
export default function Page() {
  return <DocumentsPage />;
}
