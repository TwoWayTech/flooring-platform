import type { Metadata } from "next";
import { MyHome } from "@/features/my/my-home";

export const metadata: Metadata = { title: "My portal" };

/** My portal. */
export default function Page() {
  return <MyHome />;
}
