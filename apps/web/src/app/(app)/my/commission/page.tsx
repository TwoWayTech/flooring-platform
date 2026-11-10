import type { Metadata } from "next";
import { MyCommissionPage } from "@/features/my/my-commission";

export const metadata: Metadata = { title: "My commission" };

/** My commission. */
export default function Page() {
  return <MyCommissionPage />;
}
