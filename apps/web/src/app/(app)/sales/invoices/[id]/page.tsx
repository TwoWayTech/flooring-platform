import type { Metadata } from "next";
import { InvoicePage } from "@/features/invoices/invoice-page";

export const metadata: Metadata = { title: "Invoice" };

/** One invoice as a document, with PDF download. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvoicePage invoiceId={id} />;
}
