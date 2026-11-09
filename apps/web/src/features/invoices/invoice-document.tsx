import type { ReactNode } from "react";
import { Monogram } from "@workspace/ui/components/monogram";
import type { InvoiceModel } from "./invoice-model";
import { ScrollRegion } from "@/components/scroll-region";

function Block({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div>
      <h2 className="text-muted-foreground mb-1 text-xs font-medium">{title}</h2>
      {lines.map((l, i) => (
        <p key={i} className={i === 0 ? "font-medium" : undefined}>
          {l}
        </p>
      ))}
    </div>
  );
}

function TotalRow({ label, value, strong }: { label: ReactNode; value: string; strong?: boolean }) {
  return (
    <div
      className={
        strong ? "flex justify-between gap-6 py-1.5 text-base font-semibold" : "flex justify-between gap-6 py-1"
      }
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

/** The invoice as a document on screen; the PDF renders the same model (see invoice-pdf.tsx). */
export function InvoiceDocument({ model, logoUrl }: { model: InvoiceModel; logoUrl: string | null }) {
  return (
    <article
      data-print-target
      className="bg-surface border-hairline rounded-panel flex flex-col gap-8 border p-6 text-sm sm:p-10"
    >
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-start gap-3">
          <Monogram letters={model.company.monogram} logoUrl={logoUrl} name={model.company.name} className="size-11" />
          <div className="text-muted-foreground text-xs leading-relaxed">
            <p className="text-foreground text-sm font-semibold">{model.company.name}</p>
            {model.company.lines.map((l) => (
              <p key={l}>{l}</p>
            ))}
          </div>
        </div>
        <div className="text-right">
          <p className="font-display text-2xl font-semibold tracking-[-0.01em]">Invoice {model.number}</p>
          {model.paidOn ? (
            <p className="border-success text-success-ink mt-2 inline-block rounded border-2 px-2 py-0.5 text-sm font-bold tracking-widest">
              PAID {model.paidOn}
            </p>
          ) : model.voided ? (
            <p className="border-hairline text-muted-foreground mt-2 inline-block rounded border-2 px-2 py-0.5 text-sm font-bold tracking-widest">
              VOID
            </p>
          ) : null}
          <dl className="text-muted-foreground mt-2 grid grid-cols-[auto_auto] justify-end gap-x-4 gap-y-0.5 text-xs">
            <dt>Issued</dt>
            <dd className="text-foreground">{model.issued}</dd>
            <dt>Due</dt>
            <dd className="text-foreground">{model.due}</dd>
            <dt>Terms</dt>
            <dd className="text-foreground">{model.terms}</dd>
            {model.quoteNumber ? (
              <>
                <dt>Quote</dt>
                <dd className="text-foreground">{model.quoteNumber}</dd>
              </>
            ) : null}
          </dl>
        </div>
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        <Block title="Bill to" lines={[model.billTo.name, ...model.billTo.lines]} />
        <Block title="Job site" lines={model.jobSite} />
      </div>

      <ScrollRegion label="Invoice lines">
        <table className="w-full">
          <thead className="text-muted-foreground border-hairline border-b text-xs">
            <tr>
              <th scope="col" className="py-2 text-left font-medium">
                Description
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Quantity
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Price
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {model.lines.map((line) => (
              <tr key={line.id} className="border-hairline border-b">
                <td className="py-2 pr-3">{line.description}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">{line.quantity}</td>
                <td className="px-3 py-2 text-right">{line.price}</td>
                <td className="py-2 text-right">{line.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollRegion>

      <div className="flex flex-wrap justify-between gap-8">
        <div className="text-muted-foreground max-w-sm text-xs">
          {model.payments.length > 0 ? (
            <>
              <h2 className="text-foreground mb-1 text-sm font-medium">Payments received</h2>
              <ul>
                {model.payments.map((p) => (
                  <li key={p.id} className="tabular-nums">
                    {p.date}, {p.method}, {p.amount}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
        <div className="w-full max-w-xs">
          <dl className="divide-hairline divide-y">
            <TotalRow label="Subtotal" value={model.subtotal} />
            <TotalRow label={model.taxLabel} value={model.tax} />
            <TotalRow label="Total" value={model.total} strong />
            <TotalRow label="Paid" value={model.paid} />
            {model.credited ? <TotalRow label="Credit applied" value={model.credited} /> : null}
            {model.writtenOff ? <TotalRow label="Written off" value={model.writtenOff} /> : null}
            <TotalRow label="Balance due" value={model.balanceDue} strong />
          </dl>
          {model.taxSource ? (
            <p className="text-muted-foreground pt-2 text-xs print:hidden">Tax rate: {model.taxSource}</p>
          ) : null}
        </div>
      </div>

      <footer className="text-muted-foreground border-hairline border-t pt-4 text-xs">{model.footer}</footer>
    </article>
  );
}
