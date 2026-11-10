import type { Metadata } from "next";
import { MyPaymentsPage } from "@/features/my/my-pages";

export const metadata: Metadata = { title: "My payments" };

/** My payments. */
export default function Page() {
  return <MyPaymentsPage />;
}
