import { PackageX, TriangleAlert } from "lucide-react";
import { StatusPill } from "@workspace/ui/components/status-pill";
import type { StockLevel } from "./stock";

/** Out of stock in red and Low stock in amber, always with the words (spec C3: never colour alone). */
export function StockBadge({ status }: { status: StockLevel["status"] }) {
  if (status === "out") return <StatusPill tone="danger" icon={PackageX} label="Out of stock" />;
  if (status === "low") return <StatusPill tone="warning" icon={TriangleAlert} label="Low stock" />;
  return null;
}
