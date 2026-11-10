import type { Metadata } from "next";
import { MyPayPage } from "@/features/my/my-pay";

export const metadata: Metadata = { title: "My pay" };

/** My pay. */
export default function Page() {
  return <MyPayPage />;
}
