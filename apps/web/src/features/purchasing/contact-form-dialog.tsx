"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  CONTACT_ROLE_LABELS,
  contactProblem,
  type ContactMethod,
  type ContactRole,
  type Supplier,
  type SupplierContact,
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

const METHODS: Record<ContactMethod, string> = { call: "Call", email: "Email", whatsapp: "WhatsApp" };

/** Adds or edits one person at a supplier (spec B1); saved straight to the directory. */
export function ContactFormDialog({
  supplier,
  contact,
  onClose,
  onSaved,
}: {
  supplier: Supplier;
  contact: SupplierContact | null;
  onClose: () => void;
  onSaved?: (contact: SupplierContact) => void;
}) {
  const [name, setName] = useState(contact?.name ?? "");
  const [role, setRole] = useState<ContactRole>(contact?.role ?? "sales_rep");
  const [mobile, setMobile] = useState(contact?.mobile ?? "");
  const [officePhone, setOfficePhone] = useState(contact?.officePhone ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [whatsapp, setWhatsapp] = useState(contact?.whatsapp ?? false);
  const [preferredMethod, setPreferred] = useState<ContactMethod>(contact?.preferredMethod ?? "call");
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [isPrimary, setPrimary] = useState(contact?.isPrimary ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    event.stopPropagation();
    const input = { name, role, mobile, officePhone, email, whatsapp, preferredMethod, notes, isPrimary };
    const problem = contactProblem(input);
    if (problem) return setError(problem);
    setPending(true);
    try {
      const saved = await api.saveSupplierContact({ id: contact?.id, supplierId: supplier.id, ...input });
      toast.success(`${saved.name} saved to ${supplier.name}`);
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The contact was not saved.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{contact ? `Edit ${contact.name}` : "Add contact"}</DialogTitle>
            <DialogDescription>{supplier.name}. A name, plus an email or a phone number.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="contact-name" label="Name">
              <Input id="contact-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </Field>
            <Field id="contact-role" label="Role">
              <Select value={role} onValueChange={(v) => setRole(v as ContactRole)}>
                <SelectTrigger id="contact-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(CONTACT_ROLE_LABELS) as ContactRole[]).map((r) => (
                    <SelectItem key={r} value={r}>
                      {CONTACT_ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="contact-mobile" label="Mobile">
              <Input id="contact-mobile" inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} />
            </Field>
            <Field id="contact-office" label="Office phone">
              <Input
                id="contact-office"
                inputMode="tel"
                value={officePhone}
                onChange={(e) => setOfficePhone(e.target.value)}
              />
            </Field>
            <Field id="contact-email" label="Email">
              <Input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field id="contact-method" label="Prefers">
              <Select value={preferredMethod} onValueChange={(v) => setPreferred(v as ContactMethod)}>
                <SelectTrigger id="contact-method" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(METHODS) as ContactMethod[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {METHODS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>
          <Field id="contact-notes" label="Notes">
            <Textarea id="contact-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-5">
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox checked={whatsapp} onCheckedChange={(v) => setWhatsapp(v === true)} />
              WhatsApp on this mobile
            </Label>
            <Label className="flex items-center gap-2 font-normal">
              <Checkbox checked={isPrimary} onCheckedChange={(v) => setPrimary(v === true)} />
              Primary contact
            </Label>
          </div>
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
              Save contact
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
