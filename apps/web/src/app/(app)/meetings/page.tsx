import type { Metadata } from "next";
import { MeetingsPage } from "@/features/meetings/meetings-page";

export const metadata: Metadata = { title: "Meetings" };

/** Meetings: the week calendar. */
export default function Page() {
  return <MeetingsPage />;
}
