import type { Metadata } from "next";
import { NotificationsSettingsPage } from "@/features/settings/notifications/notifications-page";

export const metadata: Metadata = { title: "Email and notifications" };

/** Email and notifications. */
export default function Page() {
  return <NotificationsSettingsPage />;
}
