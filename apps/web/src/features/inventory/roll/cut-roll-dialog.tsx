"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { dec, REMNANT_THRESHOLD_FT, validateCut, type Roll } from "@workspace/shared";
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
import { Label } from "@workspace/ui/components/label";
import { Num } from "@workspace/ui/components/num";
import { api } from "@/lib/api";

/** What the cut will leave, in words, before the person confirms it. */
function Preview({ roll, length }: { roll: Roll; length: string }) {
  const problem = length ? validateCut(roll, length) : null;
  if (!length) return <p className="text-muted-foreground">Enter how much to cut.</p>;
  if (problem) return <p className="text-danger-ink">{problem}</p>;
  const left = dec(roll.remainingLengthFt).minus(length);
  if (left.isZero()) return <p className="text-muted-foreground">Uses up the roll.</p>;
  if (!roll.isRemnant && left.lt(REMNANT_THRESHOLD_FT)) {
    return (
      <p className="text-warning-ink">
        Leaves <Num kind="quantity" value={left.toString()} unit="ft" />, which becomes a remnant (under{" "}
        {REMNANT_THRESHOLD_FT} ft).
      </p>
    );
  }
  return (
    <p className="text-muted-foreground">
      Leaves <Num kind="quantity" value={left.toString()} unit="ft" /> on the roll.
    </p>
  );
}

/**
 * "Cut roll" (spec "Inventory and roll detail"): enter a length; the gauge animates the cut, the
 * remaining length updates, and a leftover under 12 ft becomes a remnant.
 */
export function CutRollDialog({
  roll,
  open,
  onOpenChange,
}: {
  roll: Roll;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [length, setLength] = useState("");
  const [reference, setReference] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (validateCut(roll, length)) return;
    setPending(true);
    try {
      const result = await api.cutRoll(roll.id, length, reference.trim());
      toast.success(`Cut ${length} ft from ${roll.rollNumber}`, {
        description: result.remnant
          ? `Remnant ${result.remnant.rollNumber} created with ${result.remnant.remainingLengthFt} ft.`
          : undefined,
      });
      setLength("");
      setReference("");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The cut was not saved. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Cut roll {roll.rollNumber}</DialogTitle>
            <DialogDescription>
              <Num kind="quantity" value={roll.remainingLengthFt} unit="ft" /> left on a {roll.widthFt} ft wide roll.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cut-length">Length to cut</Label>
            <div className="relative">
              <Input
                id="cut-length"
                inputMode="decimal"
                autoFocus
                value={length}
                onChange={(e) => setLength(e.target.value.replace(/[^\d.]/g, ""))}
                className="pr-10 tabular-nums"
                aria-describedby="cut-preview"
              />
              <span className="text-muted-foreground absolute top-1/2 right-3 -translate-y-1/2 text-sm">ft</span>
            </div>
            <div id="cut-preview" className="text-xs" aria-live="polite">
              <Preview roll={roll} length={length} />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cut-reference">For</Label>
            <Input
              id="cut-reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Invoice or job, for example INV-1042"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !length || !!validateCut(roll, length)}>
              Cut roll
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
