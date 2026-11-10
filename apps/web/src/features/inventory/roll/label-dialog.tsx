"use client";

import { Printer } from "lucide-react";
import type { Product, Roll } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Num } from "@workspace/ui/components/num";
import { rollSqFt } from "../stock";

/** A 4 × 2 in roll label preview; Print sends only the label to the printer (see print styles). */
export function LabelDialog({
  roll,
  location,
  product,
  open,
  onOpenChange,
}: {
  roll: Roll;
  /** Warehouse and bin, e.g. "Denver Central, bin A-21". */
  location: string;
  product: Product | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Print label</DialogTitle>
          <DialogDescription>A 4 by 2 inch label for the roll end.</DialogDescription>
        </DialogHeader>
        <div
          id="print-label"
          data-print-target
          className="border-foreground bg-surface text-foreground flex aspect-[2/1] flex-col justify-between rounded-sm border-2 p-4"
        >
          <div>
            <p className="font-display text-2xl font-semibold">{roll.rollNumber}</p>
            <p className="text-sm">{product?.name}</p>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <span>
              Dye lot <strong>{roll.dyeLot}</strong>
            </span>
            <span>
              Width <strong>{roll.widthFt} ft</strong>
            </span>
            <span>
              Left{" "}
              <strong>
                <Num kind="quantity" value={roll.remainingLengthFt} unit="ft" />
              </strong>
            </span>
            <span className="col-span-2">{location}</span>
            <span>
              <Num kind="quantity" value={rollSqFt(roll)} unit="sq ft" />
            </span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button onClick={() => window.print()}>
            <Printer />
            Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
