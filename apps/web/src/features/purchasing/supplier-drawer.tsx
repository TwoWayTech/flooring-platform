"use client";

import { Pencil, Plus, Star, UserMinus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  CONTACT_ROLE_LABELS,
  contactsOf,
  SENSITIVE,
  SUPPLIER_TERMS_LABELS,
  SUPPLIER_TYPE_LABELS,
  supplierProfileGaps,
  type Supplier,
  type SupplierBalance,
  type SupplierContact,
} from "@workspace/shared";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useFormatDate } from "@/lib/use-format-date";
import { ContactActions } from "./contact-actions";
import { ContactFormDialog } from "./contact-form-dialog";
import { SupplierFormDialog } from "./supplier-form-dialog";

/** One labelled fact on the drawer. */
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * A supplier's page in the directory (spec B1): company details, terms and credit, what is owed,
 * and the people who answer your calls, each one tap away. Add, edit and deactivate happen here;
 * nothing is ever deleted, so history stays.
 */
export function SupplierDrawer({
  supplier,
  suppliers,
  contacts,
  balance,
  onClose,
}: {
  supplier: Supplier;
  suppliers: readonly Supplier[];
  contacts: readonly SupplierContact[];
  balance: SupplierBalance;
  onClose: () => void;
}) {
  const can = useCan();
  const formatDate = useFormatDate();
  const [editing, setEditing] = useState(false);
  const [contactForm, setContactForm] = useState<SupplierContact | "new" | null>(null);
  const people = contactsOf(supplier.id, [...contacts]);
  const gaps = supplierProfileGaps(supplier, [...contacts]);
  const editable = can("purchasing.supplier.edit");
  const run = (work: Promise<unknown>, done: string) =>
    work
      .then(() => toast.success(done))
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Not saved."));
  const nextStatus = supplier.status === "active" ? "inactive" : "active";

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="bg-surface w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex flex-wrap items-center gap-2">
            {supplier.name}
            {supplier.status === "inactive" ? <Badge variant="outline">Inactive</Badge> : null}
            {gaps.length ? <Badge variant="outline">Profile incomplete</Badge> : null}
          </SheetTitle>
          <SheetDescription>
            {SUPPLIER_TYPE_LABELS[supplier.type]}
            {gaps.length ? `. Still needs ${gaps.join(" and ")}.` : ""}
          </SheetDescription>
          {editable ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil />
                Edit supplier
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void run(api.setSupplierStatus(supplier.id, nextStatus), `${supplier.name} is ${nextStatus}`)
                }
              >
                {supplier.status === "active" ? "Deactivate" : "Reactivate"}
              </Button>
            </div>
          ) : null}
        </SheetHeader>
        <div className="flex flex-col gap-6 px-4 pb-6 text-sm">
          <dl className="grid grid-cols-2 gap-3">
            <Fact label="Our account number">{supplier.accountNumber || "Not set"}</Fact>
            <Fact label="Payment terms">{SUPPLIER_TERMS_LABELS[supplier.terms]}</Fact>
            <Fact label="Company email">{supplier.email || "Not set"}</Fact>
            <Fact label="Company phone">{supplier.phone || "Not set"}</Fact>
            <Fact label="Address">
              {supplier.address.street
                ? `${supplier.address.street}, ${supplier.address.city}, ${supplier.address.state} ${supplier.address.zip}`
                : "Not set"}
            </Fact>
            <Fact label="1099">
              {supplier.track1099 ? "Tracked" : "Not tracked"}
              {supplier.taxForm?.w9OnFile ? ", W-9 on file" : ""}
            </Fact>
            {can(SENSITIVE.productCost) || can("purchasing.bill.view") ? (
              <>
                <Fact label="Owed">
                  <Num kind="money" value={balance.owed} />
                </Fact>
                <Fact label="Overdue">
                  <Num kind="money" value={balance.overdue} />
                </Fact>
                <Fact label="Credit limit">
                  <Num kind="money" value={supplier.creditLimit} />
                </Fact>
                <Fact label="Next due">{balance.nextDueAt ? formatDate(balance.nextDueAt) : "None"}</Fact>
              </>
            ) : null}
          </dl>
          {supplier.notes ? <p className="text-muted-foreground">{supplier.notes}</p> : null}
          <section aria-label="Contacts" className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Contacts</h3>
              {can("purchasing.supplier.create") ? (
                <Button size="sm" variant="outline" onClick={() => setContactForm("new")}>
                  <Plus />
                  Add contact
                </Button>
              ) : null}
            </div>
            {people.length === 0 ? (
              <p className="text-muted-foreground">No contacts yet. Add the rep who answers your calls.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {people.map((c) => (
                  <li
                    key={c.id}
                    className="border-hairline flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-muted-foreground text-xs">{CONTACT_ROLE_LABELS[c.role]}</span>
                      {c.isPrimary ? (
                        <span className="text-brand-ink inline-flex items-center gap-1 text-xs">
                          <Star aria-hidden="true" className="size-3" />
                          Primary
                        </span>
                      ) : null}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      {[c.mobile && `Mobile ${c.mobile}`, c.officePhone && `Office ${c.officePhone}`, c.email]
                        .filter(Boolean)
                        .join(", ")}
                    </p>
                    {c.notes ? <p className="text-xs">{c.notes}</p> : null}
                    <span className="flex flex-wrap gap-1.5">
                      <ContactActions contact={c} />
                      {editable ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Edit ${c.name}`}
                            onClick={() => setContactForm(c)}
                          >
                            <Pencil />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            aria-label={`Deactivate ${c.name}`}
                            onClick={() => void run(api.setContactStatus(c.id, "inactive"), `${c.name} deactivated`)}
                          >
                            <UserMinus />
                            Deactivate
                          </Button>
                        </>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        {editing ? (
          <SupplierFormDialog supplier={supplier} suppliers={suppliers} onClose={() => setEditing(false)} />
        ) : null}
        {contactForm ? (
          <ContactFormDialog
            supplier={supplier}
            contact={contactForm === "new" ? null : contactForm}
            onClose={() => setContactForm(null)}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
