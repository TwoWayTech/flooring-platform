"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { ArrowLeft, MoveRight, Printer, Scissors } from "lucide-react";
import { dec, locationName, reservedOnRoll, rollAreaSqFt, rollAvailable, SENSITIVE } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { RollGauge } from "@workspace/ui/components/roll-gauge";
import { Swatch } from "@workspace/ui/components/swatch";
import { ScrollRegion } from "@/components/scroll-region";
import { QueryFallback } from "@/components/query-fallback";
import { useApiQuery } from "@/lib/api/use-api";
import { loadSalesLedger } from "@/lib/sales-ledger";
import { useFormatDate } from "@/lib/use-format-date";
import { useCan } from "@/components/workspace/workspace-context";
import { NoAccess } from "@/components/no-access";
import { rollSqYd } from "../stock";
import { CutRollDialog } from "./cut-roll-dialog";
import { LabelDialog } from "./label-dialog";
import { MoveRollDialog } from "./move-roll-dialog";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="text-sm font-medium">{children}</dd>
    </div>
  );
}

/**
 * Roll detail (spec "Inventory and roll detail", design brief wireframe): the large roll gauge,
 * dye lot, original against remaining length, location, cost with permission, cut history and
 * remnants, with Cut roll, Move and Print label.
 */
export function RollPage({ rollId }: { rollId: string }) {
  const can = useCan();
  const formatDate = useFormatDate();
  const [dialog, setDialog] = useState<"cut" | "move" | "label" | null>(null);
  const data = useApiQuery(
    async (client) => {
      const [rolls, products, users, locations, transfers, reservations, customers, sales] = await Promise.all([
        client.list("rolls"),
        client.list("products"),
        client.list("users"),
        client.list("locations"),
        client.list("transfers"),
        client.list("reservations"),
        client.list("customers"),
        loadSalesLedger(client),
      ]);
      const roll = rolls.find((r) => r.id === rollId);
      return {
        roll,
        reservations,
        customers,
        sales,
        product: products.find((p) => p.id === roll?.productId),
        remnants: rolls.filter((r) => r.parentRollId === rollId),
        users,
        locations,
        transfer: transfers.find((t) => t.id === roll?.transferId),
      };
    },
    [rollId],
  );

  if (!can("inventory.roll.view")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading roll" />;
  const { roll, product, remnants, users, locations, transfer, reservations, customers, sales } = data.data;
  if (!roll)
    return (
      <p className="text-muted-foreground">
        This roll does not exist. It may have been removed when the demo was reset.
      </p>
    );
  const location = `${locationName(locations, roll.locationId)}, bin ${roll.bin}`;

  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? "Unknown";
  const used = dec(roll.originalLengthFt).minus(roll.remainingLengthFt);

  return (
    <>
      <Link
        href="/inventory?view=rolls"
        className="text-muted-foreground hover:text-foreground -mb-3 inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Rolls
      </Link>
      <PageHeader
        title={`Roll ${roll.rollNumber}`}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="flex items-center gap-2">
              {product ? <Swatch color={product.swatch} label={product.colorName} /> : null}
              {product?.name}
            </span>
            <span>Dye lot {roll.dyeLot}</span>
            {roll.isRemnant ? <span>Remnant</span> : null}
          </span>
        }
        actions={
          <>
            {can("inventory.roll.cut") ? (
              <Button onClick={() => setDialog("cut")} disabled={dec(roll.remainingLengthFt).isZero() || !!transfer}>
                <Scissors />
                Cut roll
              </Button>
            ) : null}
            {can("inventory.roll.edit") ? (
              <Button variant="outline" onClick={() => setDialog("move")} disabled={!!transfer}>
                <MoveRight />
                Move
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => setDialog("label")}>
              <Printer />
              Print label
            </Button>
          </>
        }
      />

      <Panel bodyClassName="flex flex-col gap-6">
        <RollGauge
          originalFt={Number(roll.originalLengthFt)}
          remainingFt={Number(roll.remainingLengthFt)}
          cutsFt={roll.cuts.map((c) => Number(c.lengthFt))}
          label={`${roll.remainingLengthFt} ft of ${roll.originalLengthFt} ft left, ${roll.cuts.length} cuts`}
        />
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
          <Fact label="Width">
            <Num kind="quantity" value={roll.widthFt} unit="ft" />
          </Fact>
          <Fact label="Remaining">
            <span className="font-display text-lg font-semibold">
              <Num kind="quantity" value={roll.remainingLengthFt} unit="ft" />
            </span>{" "}
            <span className="text-muted-foreground font-normal">
              (<Num kind="quantity" value={rollSqYd(roll)} unit="sq yd" />)
            </span>
          </Fact>
          <Fact label="Reserved">
            <Num kind="quantity" value={reservedOnRoll(roll.id, reservations).toString()} unit="ft" />
          </Fact>
          <Fact label="Available">
            <Num kind="quantity" value={rollAvailable(roll, reservations).toString()} unit="ft" />
          </Fact>
          <Fact label="Original">
            <Num kind="quantity" value={roll.originalLengthFt} unit="ft" />
          </Fact>
          <Fact label="Cut so far">
            <Num kind="quantity" value={used.toString()} unit="ft" />
          </Fact>
          <Fact label="Location">
            {location}
            {transfer ? (
              <span className="text-muted-foreground block text-xs font-normal">
                In transit to {locationName(locations, transfer.toId)} on {transfer.number}
              </span>
            ) : null}
          </Fact>
          {can(SENSITIVE.productCost) ? (
            <Fact label="Cost">
              <Num kind="unitCost" value={roll.costPerSqFt} /> per sq ft
              <span className="text-muted-foreground block text-xs font-normal">
                <Num kind="money" value={rollAreaSqFt(roll.widthFt, roll.remainingLengthFt).times(roll.costPerSqFt)} />{" "}
                on hand
              </span>
            </Fact>
          ) : (
            <Fact label="Received">{formatDate(roll.receivedAt)}</Fact>
          )}
        </dl>
      </Panel>

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Cut history" bodyClassName="p-0">
          {roll.cuts.length === 0 ? (
            <p className="text-muted-foreground p-4">No cuts yet.</p>
          ) : (
            <ScrollRegion label="Cut history">
              <table className="w-full text-sm">
                <thead className="bg-raised text-muted-foreground text-xs">
                  <tr>
                    <th scope="col" className="h-9 px-4 text-left font-medium">
                      Date
                    </th>
                    <th scope="col" className="px-4 text-right font-medium">
                      Length
                    </th>
                    <th scope="col" className="px-4 text-left font-medium">
                      For
                    </th>
                    <th scope="col" className="px-4 text-left font-medium">
                      Cut by
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[...roll.cuts].reverse().map((cut) => (
                    <tr key={cut.id} className="border-hairline h-9 border-t">
                      <td className="px-4 whitespace-nowrap">{formatDate(cut.at, true)}</td>
                      <td className="px-4 text-right whitespace-nowrap">
                        <Num kind="quantity" value={cut.lengthFt} unit="ft" />
                      </td>
                      <td className="px-4 whitespace-nowrap">
                        {cut.source?.kind === "invoice" ? (
                          <Link
                            href={`/sales/invoices/${cut.source.id}`}
                            className="text-brand-ink underline-offset-4 hover:underline"
                          >
                            {cut.source.number}
                          </Link>
                        ) : (
                          cut.reference || <span className="text-muted-foreground">Not recorded</span>
                        )}
                      </td>
                      <td className="px-4 whitespace-nowrap">{userName(cut.byUserId)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </Panel>
        <Panel title="Remnants from this roll" bodyClassName="p-0">
          {remnants.length === 0 ? (
            <p className="text-muted-foreground p-4">No remnants yet. A cut that leaves less than 12 ft creates one.</p>
          ) : (
            <ul className="divide-hairline divide-y">
              {remnants.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/inventory/rolls/${r.id}`}
                    className="hover:bg-raised flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
                    <span className="font-medium">{r.rollNumber}</span>
                    <span className="text-muted-foreground">{r.bin}</span>
                    <Num kind="quantity" value={r.remainingLengthFt} unit="ft" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <CutRollDialog
        roll={roll}
        reservations={reservations}
        invoices={sales.invoices}
        ledgers={sales.ledgers}
        customers={customers}
        open={dialog === "cut"}
        onOpenChange={(o) => setDialog(o ? "cut" : null)}
      />
      <MoveRollDialog
        key={roll.bin}
        roll={roll}
        location={locationName(locations, roll.locationId)}
        open={dialog === "move"}
        onOpenChange={(o) => setDialog(o ? "move" : null)}
      />
      <LabelDialog
        roll={roll}
        location={location}
        product={product}
        open={dialog === "label"}
        onOpenChange={(o) => setDialog(o ? "label" : null)}
      />
    </>
  );
}
