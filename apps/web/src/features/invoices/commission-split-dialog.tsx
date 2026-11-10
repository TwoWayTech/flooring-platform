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
import { Pick } from "@/features/hr/pick";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";

const NOBODY = "none";

/** Shares an invoice's commission between two reps (spec C1); locked from the first confirmed payment. */
export function CommissionSplitDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const users = useApiQuery((client) => client.list("users"), []);
  const existing = invoice.commissionSplit?.[1];
  const [second, setSecond] = useState(existing?.userId ?? NOBODY);
  const [pct, setPct] = useState(invoice.commissionSplit?.[0]?.pct ?? "60");
  const [error, setError] = useState<string | null>(null);
  const others = (users.data ?? []).filter((u) => u.id !== invoice.salesRepId && u.status === "active");
  const firstName = users.data?.find((u) => u.id === invoice.salesRepId)?.name ?? "the sales rep";

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const split =
        second === NOBODY
          ? [{ userId: invoice.salesRepId, pct: "100" }]
          : [
              { userId: invoice.salesRepId, pct },
              { userId: second, pct: String(100 - Number(pct)) },
            ];
      await api.setCommissionSplit(invoice.id, split);
      toast.success("Commission split saved");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this split.");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Commission split on {invoice.number}</DialogTitle>
            <DialogDescription>
              {firstName} keeps the rest. The split locks once a payment is confirmed.
            </DialogDescription>
          </DialogHeader>
          <Field id="split-second" label="Share with">
            <Pick
              id="split-second"
              value={second}
              onChange={setSecond}
              options={[[NOBODY, "Nobody"], ...others.map((u) => [u.id, u.name] as const)]}
            />
          </Field>
          {second !== NOBODY ? (
            <Field id="split-pct" label={`${firstName}'s share %`}>
              <Input
                id="split-pct"
                inputMode="decimal"
                value={pct}
                onChange={(e) => setPct(e.target.value.replace(/[^\d.]/g, ""))}
              />
            </Field>
          ) : null}
          {error ? (
            <p role="alert" className="text-danger-ink text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save split</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
