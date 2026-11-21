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
import { dec, featureOn } from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { cn } from "@workspace/ui/lib/utils";
import { InvoiceStatusPills } from "@/lib/document-status";
import { useFormatDate } from "@/lib/use-format-date";
import { HELD_LABEL } from "./invoice-model";
import { ScheduleJob } from "./schedule-job";

/** One money figure of the invoice summary. */
export interface SummaryFigure {
  label: string;
  value: string;
  /** Remaining is the largest figure. */
  large?: boolean;
}

/**
 * The money figures at the top of an invoice (spec B2, Appendix A): Total, Paid, then Credits and
 * Written off when there are any, then Remaining, so the figures on screen add up: Remaining =
 * Total − Paid − Credits − Written off (click-through #16). Remaining never goes below zero, as in
 * the ledger.
 */
export function summaryFigures(ledger: InvoiceLedger): SummaryFigure[] {
  return [
    { label: "Total", value: ledger.total },
    { label: "Paid", value: ledger.paid },
    ...(dec(ledger.credited).gt(0) ? [{ label: "Credits", value: ledger.credited }] : []),
    ...(dec(ledger.writtenOff).gt(0) ? [{ label: "Written off", value: ledger.writtenOff }] : []),
    { label: "Remaining", value: ledger.balance, large: true },
  ];
}

function Figure({ label, value, large }: SummaryFigure) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", large && "col-span-2 sm:col-span-1")}>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className={cn("break-words", large ? "font-display text-2xl font-semibold" : "text-lg font-medium")}>
        <Num kind="money" value={value} />
      </dd>
    </div>
  );
}

/** A credit note issued against the invoice, for the summary's link to it. */
export interface CreditNoteLink {
  id: string;
  number: string;
}

/**
 * The invoice's header (spec B2): status, the money summary (total, paid, credits, remaining) in
 * front, then the credit notes issued against it, where it ships from, the job site, the due date
 * and the linked installation job. At phone width the figures sit two to a row and Remaining takes
 * its own, so nothing scrolls sideways at 375 px (click-through #27).
 */
export function InvoiceSummary({
  invoice,
  ledger,
  locations,
  job,
  customerName,
  quoteNumber,
  canSchedule,
  creditNotes,
}: {
  invoice: Invoice;
  ledger: InvoiceLedger;
  /** Live credit notes that credit this invoice (CR-xxxx). */
  creditNotes: readonly CreditNoteLink[];
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
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:flex sm:flex-wrap sm:gap-x-8">
        {summaryFigures(ledger).map((figure) => (
          <Figure key={figure.label} {...figure} />
        ))}
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
        {creditNotes.length > 0 ? (
          <div>
            <dt className="text-xs">{creditNotes.length === 1 ? "Credit note" : "Credit notes"}</dt>
            <dd className="flex flex-wrap gap-x-2">
              {creditNotes.map((note) => (
                <Link
                  key={note.id}
                  href={`/sales/invoices/${note.id}`}
                  className="text-brand-ink underline-offset-4 hover:underline"
                >
                  {note.number}
                </Link>
              ))}
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
