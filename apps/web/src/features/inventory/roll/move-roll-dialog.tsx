"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { Roll } from "@workspace/shared";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { api } from "@/lib/api";

const WAREHOUSES = ["Main warehouse", "Annex"];

/** Moves a roll to another warehouse or bin; the move is audited. */
export function MoveRollDialog({
  roll,
  open,
  onOpenChange,
}: {
  roll: Roll;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [warehouse, setWarehouse] = useState(roll.warehouse);
  const [bin, setBin] = useState(roll.bin);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const before = `${roll.warehouse}, bin ${roll.bin}`;
    const after = `${warehouse}, bin ${bin.trim()}`;
    await api.save(
      "rolls",
      { ...roll, warehouse, bin: bin.trim() },
      { category: "data", action: "Moved roll", target: `Roll ${roll.rollNumber}`, before, after },
    );
    toast.success(`Moved ${roll.rollNumber} to ${after}`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Move roll {roll.rollNumber}</DialogTitle>
            <DialogDescription>
              Now in {roll.warehouse}, bin {roll.bin}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="move-warehouse">Warehouse</Label>
            <Select value={warehouse} onValueChange={setWarehouse}>
              <SelectTrigger id="move-warehouse" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WAREHOUSES.map((w) => (
                  <SelectItem key={w} value={w}>
                    {w}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="move-bin">Bin</Label>
            <Input id="move-bin" value={bin} onChange={(e) => setBin(e.target.value)} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!bin.trim()}>
              Move roll
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
