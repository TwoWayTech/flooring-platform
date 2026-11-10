"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import type { Invoice } from "@workspace/shared";
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
 * Issues a credit note for part of an invoice (plan K-11). Tax and cost follow in proportion; the
 * credit reaches the customer's balance and reverses commission inside its clawback window.
 */
export function CreditNoteDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const [subtotal, setSubtotal] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const credit = await api.issueCreditNote(invoice.id, { subtotal, reason });
      toast.success(`Credit note ${credit.number} issued`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not issue this credit note.");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Issue a credit note for {invoice.number}</DialogTitle>
            <DialogDescription>Enter the amount before tax. Tax is added in proportion.</DialogDescription>
          </DialogHeader>
          <Field id="credit-amount" label="Amount before tax">
            <Input
              id="credit-amount"
              inputMode="decimal"
              value={subtotal}
              onChange={(e) => setSubtotal(e.target.value.replace(/[^\d.]/g, ""))}
            />
          </Field>
          <Field id="credit-reason" label="Reason">
            <Input id="credit-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {error ? (
            <p role="alert" className="text-danger-ink text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Issue credit note</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
