import type { Metadata } from "next";
import { QuotePage } from "@/features/quotes/quote-page";

export const metadata: Metadata = { title: "Quote" };

/** An existing quote in the builder. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <QuotePage quoteId={id} />;
}
