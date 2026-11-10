import type { Metadata } from "next";
import { ContractPage } from "@/features/contracts/contract-page";

export const metadata: Metadata = { title: "Contract" };

/** One contract. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ContractPage id={id} />;
}
