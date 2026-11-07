import type { Metadata } from "next";
import { RollPage } from "@/features/inventory/roll/roll-page";

export const metadata: Metadata = { title: "Roll" };

/** One roll or remnant, with its gauge, history and actions. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RollPage rollId={id} />;
}
