"use client";

import { useState, type FormEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  dec,
  receivedByLine,
  stockUnit,
  UNIT_LABELS,
  type GoodsReceipt,
  type Location,
  type Product,
  type PurchaseOrder,
  type ReceiptLine,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Field } from "@/components/field";
import { AreaQuantityInput } from "@/components/quantity/area-quantity-input";
import { CartonHint } from "@/components/quantity/carton-hint";
import { WarehouseSelect } from "@/components/warehouse-select";
import { api } from "@/lib/api";

const number = (v: string) => v.replace(/[^\d.]/g, "");

/**
 * Receive goods (spec D2): per line what arrived in good condition and what was damaged; for
 * broadloom, each roll's number, dye lot and length; the receiving warehouse. Lines start at what
 * is still to come, so a full delivery is one click and a partial one is a few edits.
 */
export function ReceiptDialog({
  po,
  receipts,
  products,
  locations,
  onClose,
}: {
  po: PurchaseOrder;
  receipts: GoodsReceipt[];
  products: Product[];
  locations: Location[];
  onClose: () => void;
}) {
  const got = receivedByLine(po.id, receipts);
  const open = po.lines
    .map((l) => ({ line: l, left: dec(l.quantity).minus(got.get(l.id) ?? 0) }))
    .filter((x) => x.left.gt(0));
  const [locationId, setLocationId] = useState(po.locationId);
  const [lines, setLines] = useState<ReceiptLine[]>(
    open.map(({ line, left }) => ({
      poLineId: line.id,
      productId: line.productId,
      received: left.toString(),
      damaged: "",
      rolls: [],
    })),
  );
  const [pending, setPending] = useState(false);
  const isRoll = (productId: string) => {
    const p = products.find((x) => x.id === productId);
    return !!p && stockUnit(p) === "ft";
  };
  const set = (i: number, patch: Partial<ReceiptLine>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const receipt = await api.recordReceipt(po.id, { locationId, lines, note: "" });
      toast.success(`${receipt.number} recorded for ${po.number}`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The receipt was not saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Receive {po.number}</DialogTitle>
            <DialogDescription>
              Enter what actually arrived. Damaged units stay out of stock and off the bill.
            </DialogDescription>
          </DialogHeader>
          <Field id="gr-location" label="Received into">
            <WarehouseSelect
              id="gr-location"
              label="Received into"
              className="w-full"
              locations={locations}
              value={locationId}
              onChange={setLocationId}
            />
          </Field>
          {lines.map((l, i) => {
            const po_line = po.lines.find((x) => x.id === l.poLineId)!;
            const unit = UNIT_LABELS[po_line.unit];
            return (
              <fieldset key={l.poLineId} className="border-hairline flex flex-col gap-2 rounded-md border p-3">
                <legend className="line-clamp-2 px-1 text-sm font-medium break-words">{po_line.description}</legend>
                <div className="grid grid-cols-2 gap-3">
                  <Field id={`gr-${i}-received`} label={`Received in good condition (${unit})`}>
                    <AreaQuantityInput
                      id={`gr-${i}-received`}
                      value={l.received}
                      sqFtPerCarton={po_line.sqFtPerCarton}
                      onChange={(received) => set(i, { received })}
                    />
                    <CartonHint quantity={l.received} sqFtPerCarton={po_line.sqFtPerCarton} />
                  </Field>
                  <Field id={`gr-${i}-damaged`} label={`Damaged (${unit})`}>
                    <AreaQuantityInput
                      id={`gr-${i}-damaged`}
                      value={l.damaged}
                      sqFtPerCarton={po_line.sqFtPerCarton}
                      onChange={(damaged) => set(i, { damaged })}
                    />
                  </Field>
                </div>
                {isRoll(l.productId) ? (
                  <div className="flex flex-col gap-2">
                    {l.rolls.map((r, k) => (
                      <div key={k} className="grid grid-cols-[1fr_1fr_6rem_auto] items-end gap-2">
                        <Field id={`gr-${i}-roll-${k}`} label="Roll number">
                          <Input
                            id={`gr-${i}-roll-${k}`}
                            value={r.rollNumber}
                            onChange={(e) =>
                              set(i, {
                                rolls: l.rolls.map((x, m) => (m === k ? { ...x, rollNumber: e.target.value } : x)),
                              })
                            }
                          />
                        </Field>
                        <Field id={`gr-${i}-lot-${k}`} label="Dye lot">
                          <Input
                            id={`gr-${i}-lot-${k}`}
                            value={r.dyeLot}
                            onChange={(e) =>
                              set(i, { rolls: l.rolls.map((x, m) => (m === k ? { ...x, dyeLot: e.target.value } : x)) })
                            }
                          />
                        </Field>
                        <Field id={`gr-${i}-len-${k}`} label="Length, ft">
                          <Input
                            id={`gr-${i}-len-${k}`}
                            inputMode="decimal"
                            value={r.lengthFt}
                            onChange={(e) =>
                              set(i, {
                                rolls: l.rolls.map((x, m) =>
                                  m === k ? { ...x, lengthFt: number(e.target.value) } : x,
                                ),
                              })
                            }
                          />
                        </Field>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove roll ${k + 1}`}
                          onClick={() => set(i, { rolls: l.rolls.filter((_, m) => m !== k) })}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="self-start"
                      onClick={() => set(i, { rolls: [...l.rolls, { rollNumber: "", dyeLot: "", lengthFt: "" }] })}
                    >
                      <Plus />
                      Add roll
                    </Button>
                    {l.rolls.length === 0 ? (
                      <p className="text-muted-foreground text-xs">
                        Without rolls entered, one roll is made for the received length.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </fieldset>
            );
          })}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              Record receipt
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
