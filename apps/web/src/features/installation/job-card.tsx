"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FilePlus2, FileText, PenLine, Play } from "lucide-react";
import { toast } from "sonner";
import {
  jobCosting,
  SENSITIVE,
  UNIT_LABELS,
  quantityKind,
  type Crew,
  type Customer,
  type Job,
  defaultAddress,
  plainAddress,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { Field } from "@/components/field";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useFormatDate } from "@/lib/use-format-date";
import { hourLabel, JobStatusPill } from "./job-status";
import { CustomerPicker } from "@/features/customers/customer-picker";
import { Label } from "@workspace/ui/components/label";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

/**
 * The job card (spec "Installation", B6): scope, materials, labor, margin for permitted roles,
 * placeholder photos, the customer's sign-off (which makes the invoice's balance due), and the
 * job's invoice, or Create invoice from this job.
 */
export function JobCard({
  job,
  crew,
  customer,
  customers,
  onClose,
}: {
  job: Job | null;
  crew: Crew | undefined;
  customer: Customer | undefined;
  /** Everyone the job could be for, for the call-centre picker (spec A6). */
  customers: Customer[];
  onClose: () => void;
}) {
  const can = useCan();
  const router = useRouter();
  const formatDate = useFormatDate();
  const [signer, setSigner] = useState("");
  const costing = job ? jobCosting(job) : null;

  async function changeCustomer(next: Customer) {
    if (!job || next.id === job.customerId) return;
    const site = next.addresses.length ? plainAddress(defaultAddress(next, "job_site")) : job.address;
    await api.save(
      "jobs",
      { ...job, customerId: next.id, address: site },
      {
        category: "data",
        action: "Changed job customer",
        target: job.number,
        before: customer?.name ?? null,
        after: next.name,
      },
    );
    toast.success(`${job.number} is now for ${next.name}`);
  }

  async function signOff() {
    if (!job || !signer.trim()) return;
    try {
      await api.signOffJob(job.id, signer);
      toast.success(`${job.number} signed off by ${signer.trim()}`, {
        description: job.invoiceId ? "Its invoice's balance is now due." : undefined,
      });
      setSigner("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The sign-off was not saved. Try again.");
    }
  }

  async function start() {
    if (!job) return;
    try {
      await api.startJob(job.id);
      toast.success(`${job.number} started`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The job was not started. Try again.");
    }
  }

  async function createInvoice() {
    if (!job) return;
    try {
      const invoice = await api.createInvoiceFromJob(job.id);
      toast.success(`Invoice ${invoice.number} created for ${job.number}`);
      router.push(`/sales/invoices/${invoice.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The invoice was not created. Try again.");
    }
  }

  return (
    <Sheet open={!!job} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="bg-surface w-full overflow-y-auto sm:max-w-lg">
        {job && costing ? (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-3">
                Job {job.number}
                <JobStatusPill status={job.status} />
              </SheetTitle>
              <SheetDescription>
                {formatDate(job.date)}, {hourLabel(job.startHour)} for {job.durationHours} hours, {crew?.name}
                {crew?.kind === "subcontractor" ? " (1099)" : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 pb-6 text-sm">
              <section>
                {can("installation.job.edit") ? (
                  <div className="mb-1 flex flex-col gap-1.5">
                    <Label htmlFor="job-customer">Customer</Label>
                    <CustomerPicker
                      id="job-customer"
                      customers={customers}
                      value={job.customerId}
                      onSelect={(c) => void changeCustomer(c)}
                    />
                  </div>
                ) : (
                  <h3 className="font-semibold">{customer?.name}</h3>
                )}
                <p className="text-muted-foreground">
                  {job.address.street}, {job.address.city}, {job.address.state}
                </p>
                <p className="mt-2">{job.scope}</p>
                {job.notes ? <p className="text-muted-foreground mt-1">{job.notes}</p> : null}
              </section>
              <section aria-labelledby="job-materials">
                <h3 id="job-materials" className="mb-1 font-semibold">
                  Materials
                </h3>
                <ul className="divide-hairline divide-y">
                  {job.materials.map((m, i) => (
                    <li key={i} className="flex justify-between gap-3 py-1.5">
                      <span>{m.description}</span>
                      <Num
                        kind={quantityKind(m.unit)}
                        value={m.quantity}
                        unit={UNIT_LABELS[m.unit]}
                        className="whitespace-nowrap"
                      />
                    </li>
                  ))}
                </ul>
              </section>
              <dl className="divide-hairline border-hairline divide-y border-t">
                <Row label="Labor hours">
                  <Num kind="quantity" value={job.laborHours} />
                </Row>
                <Row label="Revenue">
                  <Num kind="money" value={costing.revenue} />
                </Row>
                {can(SENSITIVE.jobMargin) ? (
                  <>
                    <Row label="Materials at cost">
                      <Num kind="money" value={costing.materials} />
                    </Row>
                    <Row label={crew?.kind === "subcontractor" ? "Subcontractor" : "Crew labor"}>
                      <Num kind="money" value={costing.labor} />
                    </Row>
                    <Row label="Job margin">
                      <span className="font-semibold">
                        <Num kind="money" value={costing.margin} /> (<Num kind="percent" value={costing.marginPct} />)
                      </span>
                    </Row>
                  </>
                ) : null}
              </dl>
              {job.photos.length > 0 ? (
                <section aria-labelledby="job-photos">
                  <h3 id="job-photos" className="mb-2 font-semibold">
                    Photos
                  </h3>
                  <ul className="grid grid-cols-2 gap-2">
                    {job.photos.map((p) => (
                      <li key={p.id} className="flex flex-col gap-1">
                        <span
                          role="img"
                          aria-label={`Photo placeholder: ${p.caption}`}
                          className="border-hairline aspect-[4/3] rounded-md border"
                          style={{ backgroundColor: p.tone }}
                        />
                        <span className="text-muted-foreground text-xs">{p.caption}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              {job.invoiceId && can("sales.invoice.view") ? (
                <Button asChild variant="outline" className="self-start">
                  <Link href={`/sales/invoices/${job.invoiceId}`}>
                    <FileText />
                    View invoice
                  </Link>
                </Button>
              ) : !job.invoiceId && can("sales.invoice.create") ? (
                <Button variant="outline" className="self-start" onClick={() => void createInvoice()}>
                  <FilePlus2 />
                  Create invoice from this job
                </Button>
              ) : null}
              {job.status === "signed_off" ? (
                <p className="bg-success/12 text-success-ink rounded-md px-3 py-2">
                  Signed off by {job.signedBy} on {formatDate(job.signedOffAt!)}
                </p>
              ) : job.status === "scheduled" && job.date <= api.today() && can("installation.job.edit") ? (
                <Button className="self-start" onClick={() => void start()}>
                  <Play />
                  Start job
                </Button>
              ) : job.status === "completed" || job.status === "in_progress" ? (
                can("installation.job.sign_off") ? (
                  <div className="flex items-end gap-2">
                    <Field id="signer" label="Customer signs as" className="flex-1">
                      <Input
                        id="signer"
                        value={signer}
                        onChange={(e) => setSigner(e.target.value)}
                        placeholder={customer?.contactName}
                      />
                    </Field>
                    <Button onClick={() => void signOff()} disabled={!signer.trim()}>
                      <PenLine />
                      Record sign-off
                    </Button>
                  </div>
                ) : null
              ) : null}
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
