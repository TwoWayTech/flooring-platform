"use client";

import { useState } from "react";
import { Download, Pencil } from "lucide-react";
import {
  customerStatement,
  dec,
  PAYMENT_TERM_LABELS,
  SENSITIVE,
  type Customer,
  type StatementLine,
  defaultAddress,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { downloadText, toCsv } from "@/components/data-table/csv";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { creditOf, type SalesLedger } from "@/lib/sales-ledger";
import { useFormatDate } from "@/lib/use-format-date";
import { CustomerAddresses } from "./customer-addresses";
import { IncompleteBadge } from "./customer-picker";
import { CustomerProfileDialog } from "./customer-profile-dialog";

const TYPES = { homeowner: "Homeowner", dealer: "Dealer", contractor: "Contractor" } as const;

/** What a statement line was, in words (spec Appendix A: statement with payment lines). */
const LINE_KINDS: Record<StatementLine["kind"], string> = {
  invoice: "Invoice",
  credit: "Credit note",
  payment: "Payment",
  write_off: "Write-off",
  refund: "Refund",
};

/**
 * A customer's account in a drawer: contact, terms, certificate, credit limit (sensitive), addresses
 * and statement. A customer added quickly from a picker is completed here (spec A6).
 */
export function CustomerDrawer({
  customer,
  sales,
  onClose,
}: {
  customer: Customer | null;
  sales: SalesLedger;
  onClose: () => void;
}) {
  const can = useCan();
  const formatDate = useFormatDate();
  const [editing, setEditing] = useState(false);
  const lines = customer ? customerStatement(sales, customer.id) : [];
  const credit = customer ? creditOf(sales, customer.id) : "0.00";
  const billing = customer ? defaultAddress(customer, "billing") : undefined;

  function exportStatement() {
    if (!customer) return;
    const csv = toCsv(lines, [
      { id: "date", header: "Date", value: (l) => l.date },
      { id: "kind", header: "Type", value: (l) => LINE_KINDS[l.kind] },
      { id: "reference", header: "Reference", value: (l) => l.reference },
      { id: "amount", header: "Amount", value: (l) => l.amount },
      { id: "balance", header: "Balance", value: (l) => l.balance },
    ]);
    downloadText(`statement-${customer.name.replace(/\W+/g, "-").toLowerCase()}-${api.today()}.csv`, csv);
  }

  return (
    <Sheet open={!!customer} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="bg-surface w-full overflow-y-auto sm:max-w-lg">
        {customer ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                {customer.name}
                <IncompleteBadge customer={customer} />
              </SheetTitle>
              <SheetDescription>
                {TYPES[customer.type]}
                {billing ? `, ${billing.city}, ${billing.state}` : ""}
              </SheetDescription>
              {can("customers.customer.edit") ? (
                <Button variant="outline" size="sm" className="self-start" onClick={() => setEditing(true)}>
                  <Pencil />
                  Edit profile
                </Button>
              ) : null}
            </SheetHeader>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-4 text-sm">
              <div>
                <dt className="text-muted-foreground text-xs">Contact</dt>
                <dd>{customer.contactName}</dd>
                <dd className="text-muted-foreground text-xs">{customer.phone || "No phone"}</dd>
                <dd className="text-muted-foreground text-xs">{customer.email || "No email"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Terms</dt>
                <dd>{PAYMENT_TERM_LABELS[customer.terms]}</dd>
              </div>
              {can(SENSITIVE.creditLimit) ? (
                <div>
                  <dt className="text-muted-foreground text-xs">Credit limit</dt>
                  <dd>
                    <Num kind="money" value={customer.creditLimit} />
                  </dd>
                </div>
              ) : null}
              {dec(credit).gt(0) ? (
                <div>
                  <dt className="text-muted-foreground text-xs">Customer credit</dt>
                  <dd>
                    <Num kind="money" value={credit} />
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="text-muted-foreground text-xs">Tax status</dt>
                <dd>
                  {customer.certificate
                    ? `Exempt, certificate ${customer.certificate.number}, expires ${formatDate(customer.certificate.expiresAt)}`
                    : "Taxable"}
                </dd>
              </div>
            </dl>
            <CustomerAddresses customer={customer} />
            <section className="flex flex-col gap-2 px-4 pb-6" aria-labelledby="statement-title">
              <div className="flex items-center justify-between">
                <h3 id="statement-title" className="text-sm font-semibold">
                  Statement
                </h3>
                <Button variant="outline" size="sm" onClick={exportStatement} disabled={lines.length === 0}>
                  <Download />
                  Export CSV
                </Button>
              </div>
              {lines.length === 0 ? (
                <p className="text-muted-foreground text-sm">No invoices yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-muted-foreground border-hairline border-b text-xs">
                    <tr>
                      <th scope="col" className="py-1.5 text-left font-medium">
                        Date
                      </th>
                      <th scope="col" className="py-1.5 text-left font-medium">
                        For
                      </th>
                      <th scope="col" className="py-1.5 text-right font-medium">
                        Amount
                      </th>
                      <th scope="col" className="py-1.5 text-right font-medium">
                        Balance
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i} className="border-hairline border-b">
                        <td className="py-1.5 whitespace-nowrap">{formatDate(l.date)}</td>
                        <td className="py-1.5">
                          {l.kind === "invoice" ? l.reference : `${LINE_KINDS[l.kind]}, ${l.reference}`}
                        </td>
                        <td className="py-1.5 text-right">
                          <Num kind="money" value={l.amount} />
                        </td>
                        <td className="py-1.5 text-right font-medium">
                          <Num kind="money" value={l.balance} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
            {editing ? <CustomerProfileDialog customer={customer} onClose={() => setEditing(false)} /> : null}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
