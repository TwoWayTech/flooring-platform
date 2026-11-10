"use client";

import Link from "next/link";
import {
  addressLine,
  locationName,
  type Invoice,
  type InvoiceLedger,
  type Job,
  type Location,
} from "@workspace/shared";
import { featureOn } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { InvoiceStatusPills } from "@/lib/document-status";
import { useFormatDate } from "@/lib/use-format-date";
import { HELD_LABEL } from "./invoice-model";
import { ScheduleJob } from "./schedule-job";

/** One money figure of the summary; Remaining is the largest. */
function Figure({ label, value, large }: { label: string; value: string; large?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={large ? "font-display text-2xl font-semibold" : "text-lg font-medium"}>
        <Num kind="money" value={value} />
      </dd>
    </div>
  );
}

/**
 * The invoice's header (spec B2): status, the money summary (total, paid, remaining) in front,
 * then where it ships from, the job site, the due date and the linked installation job.
 */
export function InvoiceSummary({
  invoice,
  ledger,
  locations,
  job,
  customerName,
  quoteNumber,
  canSchedule,
}: {
  invoice: Invoice;
  ledger: InvoiceLedger;
  locations: Location[];
  job: Job | undefined;
  customerName: string;
  quoteNumber: string | null;
  /** Whether the viewer may schedule an installation job for this invoice. */
  canSchedule: boolean;
}) {
  const formatDate = useFormatDate();
  return (
    <Panel bodyClassName="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-xl font-semibold">Invoice {invoice.number}</h1>
        <InvoiceStatusPills ledger={ledger} />
      </div>
      <dl className="grid grid-cols-3 gap-4 sm:max-w-xl">
        <Figure label="Total" value={ledger.total} />
        <Figure label="Paid" value={ledger.paid} />
        <Figure label="Remaining" value={ledger.balance} large />
      </dl>
      <dl className="text-muted-foreground grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs">Customer</dt>
          <dd>
            <Link
              href={`/sales?view=customers&customer=${invoice.customerId}`}
              className="text-brand-ink underline-offset-4 hover:underline"
            >
              {customerName}
            </Link>
          </dd>
        </div>
        {invoice.quoteId && quoteNumber ? (
          <div>
            <dt className="text-xs">Quote</dt>
            <dd>
              <Link
                href={`/sales/quotes/${invoice.quoteId}`}
                className="text-brand-ink underline-offset-4 hover:underline"
              >
                {quoteNumber}
              </Link>
            </dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs">Fulfilled from</dt>
          <dd className="text-foreground">{locationName(locations, invoice.locationId) || "Not set"}</dd>
        </div>
        <div>
          <dt className="text-xs">Job site</dt>
          <dd className="text-foreground">{addressLine(invoice.jobSite)}</dd>
        </div>
        <div>
          <dt className="text-xs">Due</dt>
          <dd className="text-foreground">
            {invoice.dueAt ? formatDate(invoice.dueAt) : HELD_LABEL}
            {ledger.overdue ? `, ${ledger.daysOverdue} days overdue` : ""}
          </dd>
        </div>
        {job || canSchedule || featureOn("installation.calendar") ? (
          <div>
            <dt className="text-xs">Installation job</dt>
            <dd className="text-foreground">
              {job ? (
                <Link
                  href={`/installation?week=${job.date}&job=${job.id}`}
                  className="text-brand-ink underline-offset-4 hover:underline"
                >
                  {job.number}, {formatDate(job.date)}
                </Link>
              ) : canSchedule ? (
                <ScheduleJob invoice={invoice} />
              ) : (
                "None"
              )}
            </dd>
          </div>
        ) : null}
      </dl>
    </Panel>
  );
}
