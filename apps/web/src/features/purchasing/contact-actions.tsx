"use client";

import { Copy, Mail, MessageCircle, Phone } from "lucide-react";
import { toast } from "sonner";
import { callNumber, whatsappLink, type SupplierContact } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";

/**
 * One tap to reach a contact (spec B1): call, email or WhatsApp where available, and copy for a
 * desktop with no phone handler. Links work on phones without any set-up.
 */
export function ContactActions({ contact }: { contact: SupplierContact }) {
  const number = callNumber(contact);
  const copy = () =>
    void navigator.clipboard
      .writeText(number || contact.email)
      .then(() => toast.success(`${number || contact.email} copied`));
  return (
    <span className="flex flex-wrap gap-1.5">
      {number ? (
        <Button asChild variant="outline" size="sm">
          <a href={`tel:${number}`} aria-label={`Call ${contact.name}`}>
            <Phone />
            Call
          </a>
        </Button>
      ) : null}
      {contact.email ? (
        <Button asChild variant="outline" size="sm">
          <a href={`mailto:${contact.email}`} aria-label={`Email ${contact.name}`}>
            <Mail />
            Email
          </a>
        </Button>
      ) : null}
      {contact.whatsapp && contact.mobile ? (
        <Button asChild variant="outline" size="sm">
          <a
            href={whatsappLink(contact.mobile)}
            target="_blank"
            rel="noreferrer"
            aria-label={`WhatsApp ${contact.name}`}
          >
            <MessageCircle />
            WhatsApp
          </a>
        </Button>
      ) : null}
      <Button type="button" variant="ghost" size="sm" aria-label={`Copy details for ${contact.name}`} onClick={copy}>
        <Copy />
        Copy
      </Button>
    </span>
  );
}
