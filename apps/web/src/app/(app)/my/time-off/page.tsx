import type { Metadata } from "next";
import { MyTimeOffPage } from "@/features/my/my-time-off";

export const metadata: Metadata = { title: "My time off" };

/** My time off. */
export default function Page() {
  return <MyTimeOffPage />;
}
