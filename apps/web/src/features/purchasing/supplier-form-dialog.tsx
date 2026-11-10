"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  findSimilarSupplier,
  SUPPLIER_TERMS_LABELS,
  SUPPLIER_TYPE_LABELS,
  type Supplier,
  type SupplierTerms,
  type SupplierType,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
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
import { Textarea } from "@workspace/ui/components/textarea";
import { Field } from "@/components/field";
import { api } from "@/lib/api";

/** Adds or edits a supplier in the directory (spec B1); only the name is required. */
export function SupplierFormDialog({
  supplier,
  suppliers,
  onClose,
}: {
  supplier: Supplier | null;
  suppliers: readonly Supplier[];
  onClose: () => void;
}) {
  const [name, setName] = useState(supplier?.name ?? "");
  const [type, setType] = useState<SupplierType>(supplier?.type ?? "goods");
  const [accountNumber, setAccount] = useState(supplier?.accountNumber ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [terms, setTerms] = useState<SupplierTerms>(supplier?.terms ?? "pay_on_order");
  const [creditLimit, setCredit] = useState(supplier?.creditLimit ?? "0.00");
  const [track1099, setTrack] = useState(supplier?.track1099 ?? false);
  const [w9OnFile, setW9] = useState(supplier?.taxForm?.w9OnFile ?? false);
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const similar = supplier ? undefined : findSimilarSupplier(name, suppliers);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setError("Enter the supplier's name.");
    setPending(true);
    try {
      const saved = await api.saveSupplier({
        id: supplier?.id,
        name,
        type,
        accountNumber,
        email,
        phone,
        terms,
        creditLimit,
        track1099,
        taxForm: {
          w9OnFile,
          receivedAt: supplier?.taxForm?.receivedAt ?? null,
          legalName: name,
          entityType: "",
          exemptFromReporting: false,
        },
        notes,
      });
      toast.success(`${saved.name} saved`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The supplier was not saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{supplier ? `Edit ${supplier.name}` : "Add supplier"}</DialogTitle>
            <DialogDescription>Only the name is needed now; the rest can be filled in later.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="supplier-name" label="Name">
              <Input id="supplier-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
              {similar ? (
                <p className="text-warning-ink text-xs">Did you mean {similar.name}? It is already in the directory.</p>
              ) : null}
            </Field>
            <Field id="supplier-type" label="Type">
              <Select value={type} onValueChange={(v) => setType(v as SupplierType)}>
                <SelectTrigger id="supplier-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SUPPLIER_TYPE_LABELS) as SupplierType[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {SUPPLIER_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="supplier-account" label="Our account number">
              <Input id="supplier-account" value={accountNumber} onChange={(e) => setAccount(e.target.value)} />
            </Field>
            <Field id="supplier-terms" label="Payment terms">
              <Select value={terms} onValueChange={(v) => setTerms(v as SupplierTerms)}>
                <SelectTrigger id="supplier-terms" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SUPPLIER_TERMS_LABELS) as SupplierTerms[]).map((t) => (
                    <SelectItem key={t} value={t}>
                      {SUPPLIER_TERMS_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="supplier-email" label="Company email">
              <Input id="supplier-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field id="supplier-phone" label="Company phone">
              <Input id="supplier-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field id="supplier-credit" label="Credit limit">
              <Input
                id="supplier-credit"
                inputMode="decimal"
                value={creditLimit}
                onChange={(e) => setCredit(e.target.value.replace(/[^\d.]/g, ""))}
                className="tabular-nums"
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-5">
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox checked={track1099} onCheckedChange={(v) => setTrack(v === true)} />
              Track for 1099
            </Label>
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox checked={w9OnFile} onCheckedChange={(v) => setW9(v === true)} />
              W-9 on file
            </Label>
          </div>
          <Field id="supplier-notes" label="Notes">
            <Textarea id="supplier-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
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
            <Button type="submit" disabled={pending}>
              Save supplier
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
