"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Check, FileText, Upload, X } from "lucide-react";
import { toast } from "sonner";
import {
  contractDisplayStatus,
  contractFigures,
  dec,
  insuranceStatus,
  moneyString,
  pastEndDate,
  sum,
  type ChangeOrder,
  type ContractBilling,
  type FileMeta,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { ReasonDialog } from "@/components/reason-dialog";
import { ScrollRegion } from "@/components/scroll-region";
import { useCan } from "@/components/workspace/workspace-context";
import { FileViewerDialog } from "@/features/invoices/payments/file-viewer-dialog";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { billingTaxNote } from "./billing-tax-note";
import {
  ApproveChangeOrderDialog,
  BillingDialog,
  ChangeOrderDialog,
  InsuranceDialog,
  ReleaseDialog,
  SignDialog,
  WaiverDialog,
} from "./contract-dialogs";
import { ContractFormDialog } from "./contract-form-dialog";
import { CONTRACT_STATUS } from "./contract-status";
import { ScheduleOfValues } from "./schedule-of-values";

type Dialog =
  "edit" | "sign" | "billing" | "release" | "change" | "waiver" | "insurance" | "terminate" | "close" | "void" | null;

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd className="font-display text-xl font-semibold tracking-[-0.01em]">
        <Num kind="money" value={value} />
      </dd>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-sm">{children}</p>;
}

/** "billing 1", "billings 1 and 2" or "billings 1, 2 and 3". */
function billingNumbers(numbers: readonly number[]): string {
  if (numbers.length === 1) return `billing ${numbers[0]}`;
  return `billings ${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1)}`;
}

const INSURANCE = {
  valid: { tone: "success", icon: Check, label: "Valid" },
  expiring: { tone: "warning", icon: X, label: "Expiring soon" },
  expired: { tone: "danger", icon: X, label: "Expired" },
} as const;

/** A contract (spec D2): value, invoiced, paid, retained and remaining, then its schedule, billings, changes and papers. */
export function ContractPage({ id }: { id: string }) {
  const can = useCan();
  const formatDate = useFormatDate();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [viewing, setViewing] = useState<FileMeta | null>(null);
  const [refusing, setRefusing] = useState<ChangeOrder | null>(null);
  const [approving, setApproving] = useState<ChangeOrder | null>(null);
  const data = useApiQuery(
    async (client) => {
      // One source for the contract, its papers and the companies they name, so ids match (ADR 0044).
      const [all, invoices, payments] = await Promise.all([
        client.contractsData(),
        client.list("invoices"),
        client.list("payments"),
      ]);
      const { lines, billings, waivers, certificates, customers, suppliers, locations, bills, supplierPayments } = all;
      const { schedule, supplierContacts } = all;
      const contract = all.contracts.find((c) => c.id === id);
      const orders = all.changeOrders;
      return {
        contract,
        lines,
        billings,
        orders,
        waivers,
        certificates,
        customers,
        suppliers,
        locations,
        invoices,
        payments,
        bills,
        supplierPayments,
        schedule,
        supplierContacts,
      };
    },
    [id],
  );
  if (!can("contracts.contract.view")) return <NoAccess />;
  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading contract" />;
  const d = data.data;
  const contract = d.contract;
  if (!contract) return <NoAccess message="This contract is not available." />;

  const today = api.today();
  const lines = d.lines.filter((l) => l.contractId === id);
  const billings = d.billings.filter((b) => b.contractId === id);
  const orders = d.orders.filter((o) => o.contractId === id);
  const waivers = d.waivers.filter((w) => w.contractId === id);
  const certificate = d.certificates.find((c) => c.contractId === id) ?? null;
  const figures = contractFigures(contract, d.lines, d.billings, d.orders);
  const invoiceIds = new Set(billings.filter((b) => b.status === "posted" && b.invoiceId).map((b) => b.invoiceId!));
  const billIds = new Set(billings.filter((b) => b.status === "posted" && b.billId).map((b) => b.billId!));
  const contractPayments = d.payments.filter((p) => invoiceIds.has(p.invoiceId) && p.status === "confirmed");
  const paid = sum([
    ...contractPayments.map((p) => p.amount),
    ...d.supplierPayments
      .filter((p) => p.status === "confirmed")
      .flatMap((p) => p.allocations.filter((a) => billIds.has(a.billId)).map((a) => a.amount)),
  ]);
  const party = contract.customerId
    ? d.customers.find((c) => c.id === contract.customerId)
    : d.suppliers.find((s) => s.id === contract.supplierId);
  const display = contractDisplayStatus(contract, today);
  const running = contract.status === "active" || contract.status === "completed";
  const project = contract.kind === "project";
  const latest = billings.filter((b) => b.status === "posted").sort((a, b) => b.number - a.number)[0];
  const docLink = (b: ContractBilling) => {
    if (b.invoiceId) {
      const invoice = d.invoices.find((i) => i.id === b.invoiceId);
      return invoice ? (
        <Link className="text-brand-ink underline underline-offset-2" href={`/sales/invoices/${invoice.id}`}>
          {invoice.number}
        </Link>
      ) : null;
    }
    return d.bills.find((x) => x.id === b.billId)?.number ?? null;
  };
  // Which billings a release paid out, and how much of each billing's retainage is released (rule 10a).
  const retainageOf = (b: ContractBilling) => d.schedule.billings.find((r) => r.billingId === b.id);
  const releasedOn = (b: ContractBilling) => retainageOf(b)?.released ?? b.released;
  const billingLabel = (b: ContractBilling) => {
    if (b.kind === "progress") return `Billing ${b.number}`;
    const numbers = (retainageOf(b)?.covers ?? []).flatMap((id) => billings.find((x) => x.id === id)?.number ?? []);
    return numbers.length === 0 ? "Release" : `Release of retainage from ${billingNumbers(numbers)}`;
  };
  const customer = d.customers.find((c) => c.id === contract.customerId);
  // The signer is a person: the customer's contact, else the supplier's primary contact, else nobody yet.
  const signer = customer
    ? customer.contactName === customer.name
      ? ""
      : customer.contactName
    : (d.supplierContacts.find((c) => c.supplierId === contract.supplierId && c.isPrimary && c.status === "active")
        ?.name ?? "");

  async function run(action: () => Promise<unknown>, done: string) {
    try {
      await action();
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    }
  }

  const canEdit = can("contracts.contract.edit");
  const canApprove = can("contracts.contract.approve");
  const canBill = can("contracts.billing.create");
  const compliance = can("contracts.compliance.manage");

  return (
    <>
      <PageHeader
        title={`${contract.number}, ${contract.title}`}
        actions={
          <span className="flex flex-wrap gap-2">
            {contract.status === "draft" && canEdit ? (
              <>
                <Button variant="outline" onClick={() => setDialog("edit")}>
                  Edit
                </Button>
                <Button onClick={() => void run(() => api.sendContract(id), "Sent for signature")}>
                  Send for signature
                </Button>
              </>
            ) : null}
            {contract.status === "sent" && canApprove ? (
              <Button onClick={() => setDialog("sign")}>Record signature</Button>
            ) : null}
            {contract.status === "sent" && canEdit ? (
              <Button variant="outline" onClick={() => void run(() => api.recallContract(id), "Back to draft")}>
                Recall
              </Button>
            ) : null}
            {running && project && canBill ? <Button onClick={() => setDialog("billing")}>New billing</Button> : null}
            {running && project && dec(figures.held).gt(0) && canBill ? (
              <Button variant="outline" onClick={() => setDialog("release")}>
                Release retainage
              </Button>
            ) : null}
            {running && project && can("contracts.change_order.create") ? (
              <Button variant="outline" onClick={() => setDialog("change")}>
                Change order
              </Button>
            ) : null}
            {contract.status === "active" && project && canEdit ? (
              <Button variant="outline" onClick={() => void run(() => api.completeContract(id), "Marked completed")}>
                Mark completed
              </Button>
            ) : null}
            {contract.status === "completed" && canEdit ? (
              <Button variant="outline" onClick={() => void run(() => api.closeContract(id, null), "Contract closed")}>
                Close
              </Button>
            ) : null}
            {contract.kind === "master" && running && can("contracts.contract.create") ? (
              <Button variant="outline" onClick={() => void run(() => api.renewContract(id), "Renewal draft created")}>
                Renew
              </Button>
            ) : null}
            {running && canApprove ? (
              <Button variant="ghost" onClick={() => setDialog("terminate")}>
                Terminate
              </Button>
            ) : null}
          </span>
        }
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <StatusPill {...CONTRACT_STATUS[display]} />
        {pastEndDate(contract, today) ? <span className="text-warning-ink">Past end date</span> : null}
        <span className="text-muted-foreground">
          {contract.direction === "customer" ? "Customer" : "Subcontractor"}: {party?.name}.{" "}
          {formatDate(contract.startsAt)} to {formatDate(contract.endsAt)}.
        </span>
      </div>
      {contract.terminationReason ? <p className="text-sm">Terminated: {contract.terminationReason}</p> : null}
      {project ? (
        <Panel title="Money">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            <Figure label="Contract value" value={figures.value} />
            <Figure label="Invoiced" value={figures.billed} />
            <Figure label="Paid" value={moneyString(paid)} />
            <Figure label="Retained" value={figures.held} />
            <Figure label="Remaining" value={figures.remaining} />
          </dl>
          {dec(figures.pendingChanges).isZero() ? null : (
            <p className="text-muted-foreground mt-3 text-sm">
              Pending change orders: <Num kind="money" value={figures.pendingChanges} />, not billable until approved.
            </p>
          )}
        </Panel>
      ) : (
        <Panel title="Terms">
          <p className="text-sm">{contract.notes || contract.scope}</p>
        </Panel>
      )}
      {contract.signature ? (
        <p className="text-muted-foreground text-sm">
          Simulated signature: {contract.signature.signerName}, {contract.signature.signerRole},{" "}
          {formatDate(contract.signature.signedAt.slice(0, 10))}. Recorded by {contract.signature.recordedBy}.
        </p>
      ) : null}
      {project ? (
        <ScheduleOfValues
          lines={lines}
          schedule={d.schedule.lines}
          showBilling={can("contracts.billing.view")}
          formatDate={formatDate}
        />
      ) : null}
      {project ? (
        <Panel title="Billings" bodyClassName="p-0">
          <p className="text-muted-foreground px-4 pt-3 text-sm">{billingTaxNote(contract, customer, today)}</p>
          {billings.length === 0 ? (
            <div className="p-4">
              <Empty>No billings yet.</Empty>
            </div>
          ) : (
            <ScrollRegion label="Billings">
              <table className="w-full min-w-[34rem] text-sm">
                <thead className="bg-raised text-muted-foreground text-left text-xs">
                  <tr>
                    <th className="px-4 py-2 font-medium">Billing</th>
                    <th className="px-4 py-2 font-medium">Document</th>
                    <th className="px-4 py-2 text-right font-medium">Gross</th>
                    <th className="px-4 py-2 text-right font-medium">Retained</th>
                    <th className="px-4 py-2 text-right font-medium">Released</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {billings.map((b) => (
                    <tr key={b.id} className="border-hairline border-t">
                      <td className="px-4 py-2">
                        {billingLabel(b)}, {formatDate(b.periodEnd)}
                        {b.status === "void" ? ", void" : ""}
                      </td>
                      <td className="px-4 py-2">{docLink(b)}</td>
                      <td className="px-4 py-2 text-right">
                        {b.kind === "release" ? null : <Num kind="money" value={b.gross} />}
                      </td>
                      <td className="px-4 py-2 text-right">
                        {b.kind === "release" ? null : <Num kind="money" value={b.withheld} />}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Num kind="money" value={releasedOn(b)} />
                      </td>
                      <td className="px-4 py-2 text-right">
                        {b.id === latest?.id && can("contracts.billing.void") ? (
                          <Button size="sm" variant="ghost" onClick={() => setDialog("void")}>
                            Void
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollRegion>
          )}
        </Panel>
      ) : null}
      {project ? (
        <Panel title="Change orders" bodyClassName="p-0">
          {orders.length === 0 ? (
            <div className="p-4">
              <Empty>No change orders.</Empty>
            </div>
          ) : (
            <ul className="divide-hairline divide-y text-sm">
              {orders.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <span>
                    <span className="font-medium">{o.number}</span> {o.reason}{" "}
                    <Num kind="money" value={moneyString(sum(o.lines.map((l) => l.amountDelta)))} />
                  </span>
                  {o.status === "pending" && can("contracts.change_order.approve") ? (
                    <span className="flex gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setApproving(o)}>
                        Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setRefusing(o)}>
                        Reject
                      </Button>
                    </span>
                  ) : (
                    <span className="text-muted-foreground capitalize">{o.status}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
      {can("contracts.compliance.view") && contract.supplierId ? (
        <Panel
          title="Insurance"
          actions={
            compliance ? (
              <Button size="sm" variant="outline" onClick={() => setDialog("insurance")}>
                {certificate ? "Update" : "Add certificate"}
              </Button>
            ) : null
          }
        >
          {certificate ? (
            <div className="flex flex-col gap-2 text-sm">
              <StatusPill {...INSURANCE[insuranceStatus(certificate, today)]} />
              <ul className="flex flex-col gap-1">
                {certificate.coverages.map((c) => (
                  <li key={c.type} className="flex justify-between gap-3">
                    <span className="capitalize">
                      {c.type.replace("_", " ")}, {c.insurer}
                    </span>
                    <span className="text-muted-foreground">Expires {formatDate(c.expiresOn)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Empty>No certificate on file.</Empty>
          )}
        </Panel>
      ) : null}
      {can("contracts.compliance.view") && project ? (
        <Panel
          title="Lien waivers"
          actions={
            compliance ? (
              <Button size="sm" variant="outline" onClick={() => setDialog("waiver")}>
                Record waiver
              </Button>
            ) : null
          }
          bodyClassName="p-0"
        >
          {waivers.length === 0 ? (
            <div className="p-4">
              <Empty>No waivers yet.</Empty>
            </div>
          ) : (
            <ul className="divide-hairline divide-y text-sm">
              {waivers.map((w) => (
                <li key={w.id} className="flex flex-wrap justify-between gap-3 px-4 py-2.5">
                  <span className="capitalize">
                    {w.type.replaceAll("_", " ")}, through {formatDate(w.throughDate)}
                  </span>
                  <span>
                    <Num kind="money" value={w.amount} />{" "}
                    <span className="text-muted-foreground capitalize">{w.status}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
      <Panel
        title="Documents"
        actions={
          canEdit ? (
            <label className="hover:bg-raised inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-sm">
              <Upload aria-hidden="true" className="size-4" />
              Add
              <input
                type="file"
                multiple
                className="sr-only"
                aria-label="Add a contract document"
                onChange={(e) =>
                  e.target.files?.length &&
                  void run(() => api.addContractFiles(id, [...e.target.files!]), "Document added")
                }
              />
            </label>
          ) : null
        }
      >
        {contract.files.length === 0 ? (
          <Empty>No documents yet.</Empty>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {contract.files.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  className="hover:text-brand-ink inline-flex items-center gap-2 underline-offset-2 hover:underline"
                  onClick={() => setViewing(f)}
                >
                  <FileText aria-hidden="true" className="size-4" />
                  {f.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      {dialog === "edit" ? (
        <ContractFormDialog
          contract={contract}
          lines={lines}
          customers={d.customers}
          suppliers={d.suppliers}
          locations={d.locations}
          onClose={() => setDialog(null)}
          onSaved={() => setDialog(null)}
        />
      ) : null}
      {dialog === "sign" ? <SignDialog contract={contract} signer={signer} onClose={() => setDialog(null)} /> : null}
      {dialog === "billing" ? (
        <BillingDialog contract={contract} lines={lines} billings={billings} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "release" ? (
        <ReleaseDialog contract={contract} held={figures.held} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "change" ? (
        <ChangeOrderDialog contract={contract} lines={lines} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "waiver" ? (
        <WaiverDialog contract={contract} payments={contractPayments} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "insurance" ? (
        <InsuranceDialog contract={contract} certificate={certificate} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === "terminate" ? (
        <ReasonDialog
          title={`Terminate ${contract.number}`}
          description="Billing stops. Retained money stays held until released."
          confirmLabel="Terminate"
          destructive
          onConfirm={(reason) => api.terminateContract(id, reason)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "void" && latest ? (
        <ReasonDialog
          title={`Void billing ${latest.number}`}
          description="Only the latest billing can be voided, and only while nothing on it is paid."
          confirmLabel="Void billing"
          destructive
          onConfirm={(reason) => api.voidBilling(latest.id, reason)}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {approving ? (
        <ApproveChangeOrderDialog order={approving} value={figures.value} onClose={() => setApproving(null)} />
      ) : null}
      {refusing ? (
        <ReasonDialog
          title={`Reject ${refusing.number}`}
          description="Say why, so the team can revise it."
          confirmLabel="Reject"
          onConfirm={(reason) => api.decideChangeOrder(refusing.id, { approve: false, reason })}
          onClose={() => setRefusing(null)}
        />
      ) : null}
      {viewing ? <FileViewerDialog file={viewing} onClose={() => setViewing(null)} /> : null}
    </>
  );
}
