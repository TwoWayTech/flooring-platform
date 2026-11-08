"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ADDRESS_LABELS, addressLine, type Customer, type CustomerAddress } from "@workspace/shared";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { AddressDialog } from "./address-dialog";

/**
 * A customer's addresses in the drawer (spec A6): each with its label and whether it is the
 * default for billing or job sites; add, edit and remove for people who may edit customers.
 */
export function CustomerAddresses({ customer }: { customer: Customer }) {
  const can = useCan();
  const editable = can("customers.customer.edit");
  const [editing, setEditing] = useState<CustomerAddress | "new" | null>(null);

  async function remove(address: CustomerAddress) {
    await api.saveCustomer({ ...customer, addresses: customer.addresses.filter((a) => a.id !== address.id) });
    toast.success("Address removed");
  }

  return (
    <section className="flex flex-col gap-2 px-4" aria-labelledby="addresses-title">
      <div className="flex items-center justify-between">
        <h3 id="addresses-title" className="text-sm font-semibold">
          Addresses
        </h3>
        {editable ? (
          <Button variant="outline" size="sm" onClick={() => setEditing("new")}>
            <Plus />
            Add address
          </Button>
        ) : null}
      </div>
      {customer.addresses.length === 0 ? (
        <p className="text-muted-foreground text-sm">No address yet. Add one to complete the profile.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {customer.addresses.map((a) => (
            <li key={a.id} className="border-hairline flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium">{ADDRESS_LABELS[a.label]}</span>
                  {customer.defaultBillingId === a.id ? <Badge variant="secondary">Billing default</Badge> : null}
                  {customer.defaultJobSiteId === a.id ? <Badge variant="secondary">Job site default</Badge> : null}
                </span>
                <span className="text-muted-foreground block">{addressLine(a)}</span>
                {a.county ? <span className="text-muted-foreground block text-xs">{a.county} County</span> : null}
              </span>
              {editable ? (
                <span className="flex gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Edit ${addressLine(a)}`}
                    onClick={() => setEditing(a)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${addressLine(a)}`}
                    onClick={() => void remove(a)}
                  >
                    <Trash2 />
                  </Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {editing ? (
        <AddressDialog
          customer={customer}
          address={editing === "new" ? null : editing}
          initialLabel={
            customer.addresses.length === 0 ? (customer.type === "homeowner" ? "home" : "billing") : "job_site"
          }
          onClose={() => setEditing(null)}
          onSaved={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}
