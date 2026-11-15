import type { Metadata } from "next";
import { BillingPage } from "@/features/settings/billing/billing-page";

export const metadata: Metadata = { title: "Billing" };

/** Settings: Billing, the Owner's read-only plan, period and limits (docs/specs/platform-admin.md, part 4). */
export default function Page() {
  return <BillingPage />;
}
