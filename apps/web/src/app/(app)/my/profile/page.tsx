import type { Metadata } from "next";
import { MyProfilePage } from "@/features/my/my-pages";

export const metadata: Metadata = { title: "My profile" };

/** My profile. */
export default function Page() {
  return <MyProfilePage />;
}
