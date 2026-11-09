import type { Metadata } from "next";
import { PaymentsSettingsPage } from "@/features/settings/payments/payments-page";

export const metadata: Metadata = { title: "Payments" };

/** Settings: Payments. */
export default function Page() {
  return <PaymentsSettingsPage />;
}
