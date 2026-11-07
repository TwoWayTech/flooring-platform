import type { Metadata } from "next";
import { NumberFormatPage } from "@/features/settings/number-format-page";

export const metadata: Metadata = { title: "Number format" };

/** Settings: Number format. */
export default function Page() {
  return <NumberFormatPage />;
}
