"use client";

import Link from "next/link";
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
import { Field } from "@/components/field";
import { api } from "@/lib/api";

/**
 * Moves a roll to another bin in the same warehouse; the move is audited. Another warehouse
 * goes through a transfer, so stock never changes place without a document (plan K-11).
 */
export function MoveRollDialog({
  roll,
  location,
  open,
  onOpenChange,
}: {
  roll: Roll;
  location: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [bin, setBin] = useState(roll.bin);

  async function submit(event: FormEvent) {
    event.preventDefault();
    await api.moveRoll(roll.id, bin.trim());
    toast.success(`Moved ${roll.rollNumber} to bin ${bin.trim()}`);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Move roll {roll.rollNumber}</DialogTitle>
            <DialogDescription>
              Now in {location}, bin {roll.bin}.
            </DialogDescription>
          </DialogHeader>
          <Field
            id="move-bin"
            label="Bin"
            hint={
              <>
                To send it to another warehouse, start a{" "}
                <Link href="/inventory?view=transfers" className="underline underline-offset-2">
                  transfer
                </Link>
                .
              </>
            }
          >
            <Input
              id="move-bin"
              value={bin}
              onChange={(e) => setBin(e.target.value)}
              required
              aria-describedby="move-bin-hint"
            />
          </Field>
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
