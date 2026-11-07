import type { Metadata } from "next";
import { QuotePage } from "@/features/quotes/quote-page";

export const metadata: Metadata = { title: "New quote" };

/** Starts a new quote in the builder. */
export default function Page() {
  return <QuotePage quoteId={null} />;
}
