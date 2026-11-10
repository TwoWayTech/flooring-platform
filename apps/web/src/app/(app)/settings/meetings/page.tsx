import type { Metadata } from "next";
import { MeetingsSettingsPage } from "@/features/settings/meetings/meetings-settings-page";

export const metadata: Metadata = { title: "Meeting settings" };

/** Settings → Meetings. */
export default function Page() {
  return <MeetingsSettingsPage />;
}
