"use client";

import Link from "next/link";
import { useState } from "react";
import { PackageCheck, Scissors } from "lucide-react";
import { toast } from "sonner";
import {
  locationName,
  mayIssue,
  stockUnit,
  type Invoice,
  type InvoiceLedger,
  type Location,
  type Product,
  type Reservation,
  type Roll,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { ReasonDialog } from "@/components/reason-dialog";
import { ScrollRegion } from "@/components/scroll-region";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";

const UNIT = { ft: "ft", cartons: "cartons", each: "each" } as const;

/**
 * The stock an invoice holds (spec C2): per line, the roll length or cartons reserved at its
 * warehouse, or what is short. Cut / Issue works once a deposit or payment is confirmed; before
 * that only with inventory.reservation.override and a reason, which is audited.
 */
export function InvoiceStock({
  invoice,
  ledger,
  reservations,
  products,
  rolls,
  locations,
}: {
  invoice: Invoice;
  ledger: InvoiceLedger;
  reservations: Reservation[];
  products: Product[];
  rolls: Roll[];
  locations: Location[];
}) {
  const can = useCan();
  const [overriding, setOverriding] = useState<Reservation | null>(null);
  const own = reservations.filter((r) => r.invoiceId === invoice.id);
  if (own.length === 0) return null;
  const paid = mayIssue(ledger);
  const canCut = can("inventory.roll.cut");
  const canOverride = can("inventory.reservation.override");

  const issue = (r: Reservation, reason?: string) =>
    api
      .issueReservation(r.id, reason)
      .then(() =>
        toast.success(r.rollId ? `Cut ${r.quantity} ft for ${invoice.number}` : `Issued for ${invoice.number}`),
      );

  return (
    <Panel title="Stock">
      {!paid && own.some((r) => r.status === "active") ? (
        <p className="text-muted-foreground mb-3 text-sm">
          Stock is reserved. It can be cut or issued once a deposit or payment is confirmed.
        </p>
      ) : null}
      <ScrollRegion label="Reserved stock">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="text-muted-foreground border-hairline border-b text-xs">
            <tr>
              {["Item", "From", "Quantity", "Status", ""].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className={h === "Quantity" ? "py-2 pr-3 text-right font-medium" : "py-2 pr-3 text-left font-medium"}
                >
                  {h || <span className="sr-only">Actions</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {own.map((r) => {
              const product = products.find((p) => p.id === r.productId);
              const line = invoice.lines.find((l) => l.id === r.lineId);
              const roll = rolls.find((x) => x.id === r.rollId);
              const unit = UNIT[(product && stockUnit(product)) || "each"];
              const short = r.shortBy !== "0";
              return (
                <tr key={r.id} className="border-hairline border-b">
                  <td className="py-2 pr-3">{line?.description ?? product?.name}</td>
                  <td className="py-2 pr-3">
                    {roll ? (
                      <Link
                        href={`/inventory/rolls/${roll.id}`}
                        className="text-brand-ink underline-offset-4 hover:underline"
                      >
                        Roll {roll.rollNumber}
                      </Link>
                    ) : null}
                    <span className="text-muted-foreground block text-xs">{locationName(locations, r.locationId)}</span>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <Num kind="quantity" value={r.quantity} unit={unit} />
                  </td>
                  <td className="py-2 pr-3">
                    {r.status === "issued" ? (
                      <StatusPill tone="success" icon={PackageCheck} label={r.rollId ? "Cut" : "Issued"} />
                    ) : r.status === "released" ? (
                      <span className="text-muted-foreground">Released</span>
                    ) : short ? (
                      <span className="text-warning-ink">
                        Short by <Num kind="quantity" value={r.shortBy} unit={unit} />, not reserved
                      </span>
                    ) : (
                      <span>Reserved</span>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    {r.status === "active" && Number(r.quantity) > 0 && canCut ? (
                      paid ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void issue(r).catch((e: unknown) =>
                              toast.error(e instanceof Error ? e.message : "Not saved."),
                            )
                          }
                        >
                          <Scissors />
                          {r.rollId ? "Cut" : "Issue"}
                        </Button>
                      ) : canOverride ? (
                        <Button size="sm" variant="ghost" onClick={() => setOverriding(r)}>
                          {r.rollId ? "Cut before payment" : "Issue before payment"}
                        </Button>
                      ) : null
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
      {overriding ? (
        <ReasonDialog
          title={overriding.rollId ? "Cut before payment" : "Issue before payment"}
          description={`${invoice.number} has no confirmed payment yet. The reason goes to the audit log.`}
          confirmLabel={overriding.rollId ? "Cut now" : "Issue now"}
          onConfirm={(reason) => issue(overriding, reason)}
          onClose={() => setOverriding(null)}
        />
      ) : null}
    </Panel>
  );
}
