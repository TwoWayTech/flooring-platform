import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MeetingsSettingsPage } from "@/features/settings/meetings/meetings-settings-page";
import { isDemoMode } from "@/lib/data-source";

export const metadata: Metadata = { title: "Meeting settings" };

/**
 * Settings → Meetings. Demo only: in api mode the page is not found, because it would save to the
 * browser's demo data while the API reads the company's stored settings (ADR 0051 "Part 3"; part 4
 * builds it on the API).
 */
export default function Page() {
  if (!isDemoMode()) notFound();
  return <MeetingsSettingsPage />;
}
