"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { damagedLines, moneyString, receivedValue, type GoodsReceipt, type PurchaseOrder } from "@workspace/shared";
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
import { Num } from "@workspace/ui/components/num";
import { Field } from "@/components/field";
import { api } from "@/lib/api";
import { ProofFilesField } from "@/features/invoices/payments/proof-files-field";
import { DamagedLines } from "./damaged-quantity";

/**
 * Enter the supplier's bill (spec D2): only against goods received and not yet billed; the total
 * starts at what they are worth at the PO's costs, a different total is flagged on the bill, and
 * the supplier's invoice file is attached. Damaged units, which are not billed, are listed.
 */
export function BillDialog({
  po,
  receipts,
  onClose,
}: {
  po: PurchaseOrder;
  receipts: GoodsReceipt[];
  onClose: () => void;
}) {
  const expected = moneyString(receivedValue(po, receipts));
  const [number, setNumber] = useState("");
  const [issuedAt, setIssuedAt] = useState(api.today());
  const [total, setTotal] = useState(expected);
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      const bill = await api.enterBill(po.id, { number, issuedAt, total }, files);
      toast.success(
        bill.matchIssues.length
          ? `Bill ${bill.number} entered with a difference to check`
          : `Bill ${bill.number} entered`,
      );
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The bill was not saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Enter bill for {po.number}</DialogTitle>
            <DialogDescription>
              For {receipts.map((r) => r.number).join(", ")}: received goods worth <Num kind="money" value={expected} />
              .
            </DialogDescription>
          </DialogHeader>
          <DamagedLines lines={damagedLines(po, receipts)} className="text-warning-ink text-sm" />
          <Field id="bill-number" label="Supplier's bill number">
            <Input id="bill-number" value={number} onChange={(e) => setNumber(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field id="bill-date" label="Bill date">
              <Input
                id="bill-date"
                type="date"
                max={api.today()}
                value={issuedAt}
                onChange={(e) => setIssuedAt(e.target.value)}
              />
            </Field>
            <Field id="bill-total" label="Bill total">
              <Input
                id="bill-total"
                inputMode="decimal"
                value={total}
                onChange={(e) => setTotal(e.target.value.replace(/[^\d.]/g, ""))}
                className="text-right tabular-nums"
              />
            </Field>
          </div>
          {total && total !== expected ? (
            <p className="text-warning-ink text-sm" role="status">
              The total differs from the goods received; the bill will be flagged for a check.
            </p>
          ) : null}
          <ProofFilesField
            dropHint="the supplier's invoice"
            id="bill-files"
            label="Supplier's invoice"
            files={files}
            onChange={setFiles}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending || !number.trim() || files.length === 0}>
              Enter bill
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
