"use client";

import Link from "next/link";
import { CreditCard, Eye } from "lucide-react";
import { billingNoticeText, type OwnerBillingNotice } from "@workspace/shared";
import { cn } from "@workspace/ui/lib/utils";
import { useFormatDate } from "@/lib/use-format-date";

const TONES = {
  warning: "bg-warning/14 text-warning-ink",
  danger: "bg-danger/12 text-danger-ink",
} as const;

/**
 * The Owner's account notice (docs/specs/platform-admin.md, part 4, "The Owner's banner"): an
 * overdue payment inside its grace, or a read-only account with its reason and, when known, the day
 * it locks. Dates show in the company's format and the browser's time zone. The shell's banner links
 * to Billing; the Billing page shows the same notice without the link. A read-only database has no
 * link, because billing can't change it.
 */
export function BillingNotice({ notice, showLink }: { notice: OwnerBillingNotice; showLink: boolean }) {
  const formatDate = useFormatDate();
  const text = billingNoticeText(notice, (iso) => formatDate(iso));
  const Icon = notice.kind === "payment_overdue" ? CreditCard : Eye;
  return (
    <section
      role="status"
      aria-label="Account notice"
      className={cn("flex flex-wrap items-start gap-x-3 gap-y-2 rounded-md px-3 py-2.5 text-sm", TONES[text.tone])}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} />
      <p className="min-w-0 flex-1 basis-56">
        <strong className="block font-semibold">{text.title}</strong>
        {text.body}
      </p>
      {text.linksToBilling && showLink ? (
        <Link
          href="/settings/billing"
          className="ml-7 self-center font-medium whitespace-nowrap underline underline-offset-2 hover:no-underline sm:ml-0"
        >
          Open billing
        </Link>
      ) : null}
    </section>
  );
}
