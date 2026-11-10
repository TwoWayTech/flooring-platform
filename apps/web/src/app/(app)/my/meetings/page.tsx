import type { Metadata } from "next";
import { MyMeetingsPage } from "@/features/my/my-pages";

export const metadata: Metadata = { title: "My meetings" };

/** My meetings. */
export default function Page() {
  return <MyMeetingsPage />;
}
