"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { CONTACT_ROLE_LABELS, contactsOf, type Supplier, type SupplierContact } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { useCan } from "@/components/workspace/workspace-context";
import { ContactFormDialog } from "./contact-form-dialog";

/**
 * The sales rep on a purchase order (spec B2): the supplier's contacts, primary first, with Add
 * new contact beside it. Whoever is added here is saved to the directory at once.
 */
export function ContactPicker({
  id,
  supplier,
  contacts,
  value,
  onChange,
}: {
  id: string;
  supplier: Supplier | undefined;
  contacts: readonly SupplierContact[];
  value: string;
  onChange: (contactId: string) => void;
}) {
  const can = useCan();
  const [adding, setAdding] = useState(false);
  const people = supplier ? contactsOf(supplier.id, [...contacts]) : [];
  return (
    <div className="flex items-center gap-2">
      <Select value={value} onValueChange={onChange} disabled={!supplier || people.length === 0}>
        <SelectTrigger id={id} className="w-full min-w-0">
          <SelectValue placeholder={supplier ? "No contacts yet" : "Choose a supplier first"} />
        </SelectTrigger>
        <SelectContent>
          {people.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}, {CONTACT_ROLE_LABELS[c.role]}
              {c.isPrimary ? ", primary" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {supplier && can("purchasing.supplier.create") ? (
        <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setAdding(true)}>
          <Plus />
          Add new contact
        </Button>
      ) : null}
      {adding && supplier ? (
        <ContactFormDialog
          supplier={supplier}
          contact={null}
          onClose={() => setAdding(false)}
          onSaved={(c) => onChange(c.id)}
        />
      ) : null}
    </div>
  );
}
