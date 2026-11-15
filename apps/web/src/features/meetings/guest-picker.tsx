"use client";

import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import type { Attendee, GuestOption } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Field } from "@/components/field";
import { Pick } from "@/features/hr/pick";
import type { MeetingsData, NewGuest } from "@/lib/api/contract";

/** The fields a guest starts with, before anyone has answered. */
const fresh = (kind: Attendee["kind"], id: string, name: string, email: string): Attendee => ({
  kind,
  id,
  name,
  email,
  role: "required",
  partStat: "needs-action",
  respondedAt: null,
  respondedSequence: null,
  note: "",
  proposal: null,
});

const KIND_LABEL: Record<Attendee["kind"], string> = {
  staff: "Staff",
  customer: "Customer",
  supplier: "Supplier",
  "customer-contact": "Customer contact",
  "supplier-contact": "Supplier contact",
  external: "Guest",
};

const looksLikeEmail = (text: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text.trim());

/**
 * Finds guests from one search: staff, customers, people at customers and suppliers, or someone
 * new by email (spec E). The choices are the server's own list of whom this reader may invite
 * (GET /meeting-guests, ADR 0051), so nothing they can't read is offered. Staff come with no
 * address: typing a colleague's address offers "Add guest by email", and the server makes it that
 * colleague. What happens to a new guest is set in Settings → Meetings, in the demo only; on the
 * API a new guest is invited and never saved, so "Save under customer" does not show.
 */
export function GuestPicker({
  guests,
  newGuests,
  options,
  newGuestHandling,
  onGuests,
  onNewGuests,
}: {
  guests: Attendee[];
  newGuests: NewGuest[];
  options: readonly GuestOption[];
  newGuestHandling: MeetingsData["newGuestHandling"];
  onGuests: (guests: Attendee[]) => void;
  onNewGuests: (guests: NewGuest[]) => void;
}) {
  const customers = useMemo(() => options.filter((o) => o.kind === "customer"), [options]);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState(customers[0]?.id ?? "");
  const all = useMemo(() => options.map((o) => fresh(o.kind, o.id, o.name, o.email)), [options]);
  const q = text.trim().toLowerCase();
  const taken = new Set(guests.map((g) => `${g.kind}-${g.id}`));
  const matches = q
    ? all
        .filter(
          (g) =>
            !taken.has(`${g.kind}-${g.id}`) && (g.name.toLowerCase().includes(q) || g.email.toLowerCase().includes(q)),
        )
        .slice(0, 8)
    : [];
  const known = all.some((g) => g.email.toLowerCase() === q) || newGuests.some((g) => g.email.toLowerCase() === q);
  const canAddEmail = looksLikeEmail(text) && !known;
  // "Save under customer" only where the demo keeps new guests as contacts and the reader may read a customer.
  const saveUnder = newGuestHandling === "contact" && customers.length > 0;

  function addEmail() {
    onNewGuests([...newGuests, { email: text.trim(), name: name.trim(), customerId: saveUnder ? customerId : null }]);
    setText("");
    setName("");
  }

  return (
    <div className="flex flex-col gap-2">
      <Field id="guest-search" label="Guests" hint="Search people and companies, or type an email address.">
        <Input id="guest-search" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" />
      </Field>
      {matches.length > 0 ? (
        <ul
          className="border-hairline max-h-44 divide-y overflow-y-auto rounded-md border text-sm"
          aria-label="Guest results"
        >
          {matches.map((g) => (
            <li key={`${g.kind}-${g.id}`}>
              <button
                type="button"
                className="hover:bg-raised flex w-full justify-between gap-3 px-3 py-2 text-left"
                onClick={() => {
                  onGuests([...guests, g]);
                  setText("");
                }}
              >
                <span>{g.name}</span>
                <span className="text-muted-foreground">{KIND_LABEL[g.kind]}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {canAddEmail ? (
        <div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <Field id="guest-name" label="Name (optional)">
            <Input id="guest-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          {saveUnder ? (
            <Field id="guest-customer" label="Save under customer">
              <Pick
                id="guest-customer"
                value={customerId}
                onChange={setCustomerId}
                options={customers.map((c) => [c.id, c.name] as const)}
              />
            </Field>
          ) : (
            <span />
          )}
          <Button type="button" variant="outline" onClick={addEmail}>
            <Plus />
            Add guest by email
          </Button>
        </div>
      ) : null}
      <ul className="flex flex-wrap gap-1.5" aria-label="Guests invited">
        {guests.map((g) => (
          <li
            key={`${g.kind}-${g.id}`}
            className="bg-raised inline-flex items-center gap-1 rounded-md py-1 pr-1 pl-2 text-xs"
          >
            {g.name}
            <span className="text-muted-foreground">({KIND_LABEL[g.kind].toLowerCase()})</span>
            <button
              type="button"
              aria-label={`Remove ${g.name}`}
              className="hover:bg-surface rounded-sm p-0.5"
              onClick={() => onGuests(guests.filter((x) => x !== g))}
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </li>
        ))}
        {newGuests.map((g) => (
          <li key={g.email} className="bg-raised inline-flex items-center gap-1 rounded-md py-1 pr-1 pl-2 text-xs">
            {g.name || g.email}
            <span className="text-muted-foreground">(new guest)</span>
            <button
              type="button"
              aria-label={`Remove ${g.email}`}
              className="hover:bg-surface rounded-sm p-0.5"
              onClick={() => onNewGuests(newGuests.filter((x) => x !== g))}
            >
              <X aria-hidden="true" className="size-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
