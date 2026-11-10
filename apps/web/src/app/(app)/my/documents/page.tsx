import type { Metadata } from "next";
import { MyDocumentsPage } from "@/features/my/my-pages";

export const metadata: Metadata = { title: "My documents" };

/** My documents. */
export default function Page() {
  return <MyDocumentsPage />;
}
