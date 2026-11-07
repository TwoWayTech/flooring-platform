"use client";

import { useState, type FormEvent } from "react";
import { CalendarPlus, Check, CircleCheck, Clock, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { daysBetween, type PtoRequest } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { QueryFallback } from "@/components/query-fallback";
import { DataTable } from "@/components/data-table/data-table";
import type { ColumnSpec } from "@/components/data-table/types";
import { Field } from "@/components/field";
import { NoAccess } from "@/components/no-access";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { HrTabs } from "./hr-tabs";

const STATUS = {
  pending: { tone: "warning", icon: Clock, label: "Pending" },
  approved: { tone: "success", icon: CircleCheck, label: "Approved" },
  denied: { tone: "neutral", icon: XCircle, label: "Denied" },
} as const;
const KINDS: Record<PtoRequest["kind"], string> = { vacation: "Vacation", sick: "Sick", personal: "Personal" };
/** A day off counts as 8 hours against the balance. */
const HOURS_PER_DAY = 8;

/** Ask for time off: dates, kind and an optional note; it starts as pending. */
function RequestDialog({
  employeeId,
  open,
  onOpenChange,
}: {
  employeeId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const today = api.today();
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [kind, setKind] = useState<PtoRequest["kind"]>("vacation");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (end < start) return setError("The last day must be on or after the first day.");
    const days = daysBetween(start, end) + 1;
    const request: PtoRequest = {
      id: `pto-${crypto.randomUUID().slice(0, 8)}`,
      employeeId,
      start,
      end,
      hours: String(days * HOURS_PER_DAY),
      kind,
      status: "pending",
      note,
    };
    await api.save("ptoRequests", request, {
      category: "data",
      action: "Requested time off",
      target: `${start} to ${end}`,
      before: null,
      after: `${days} days, pending`,
    });
    toast.success("Time-off request sent");
    setError(null);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Request time off</DialogTitle>
            <DialogDescription>Your manager reviews it; you see the answer here.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pto-start" label="First day">
              <Input id="pto-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
            </Field>
            <Field id="pto-end" label="Last day">
              <Input id="pto-end" type="date" value={end} onChange={(e) => setEnd(e.target.value)} required />
            </Field>
            <Field id="pto-kind" label="Kind">
              <Select value={kind} onValueChange={(v) => setKind(v as PtoRequest["kind"])}>
                <SelectTrigger id="pto-kind" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KINDS) as PtoRequest["kind"][]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KINDS[k]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field id="pto-note" label="Note">
              <Input id="pto-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>
          {error ? (
            <p role="alert" className="text-danger-ink text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Send request</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Time off (spec "HR host"): requests with approve or deny, balances, and asking for your own. */
export function TimeOffPage() {
  const can = useCan();
  const { user, product } = useWorkspace();
  const formatDate = useFormatDate();
  const [asking, setAsking] = useState(false);
  const data = useApiQuery(async (client) => {
    const [ptoRequests, employees] = await Promise.all([client.list("ptoRequests"), client.list("employees")]);
    return { ptoRequests, employees };
  }, []);
  if (!can("hr.pto.view")) return <NoAccess />;
  const canDecide = can("hr.pto.approve");

  async function decide(request: PtoRequest, status: "approved" | "denied", name: string) {
    await api.save(
      "ptoRequests",
      { ...request, status },
      {
        category: "data",
        action: status === "approved" ? "Approved time off" : "Denied time off",
        target: `${name}, ${request.start}`,
        before: "pending",
        after: status,
      },
    );
    toast.success(`Time off ${status} for ${name}`);
  }

  const nameOf = (id: string) => data.data?.employees.find((e) => e.id === id)?.name ?? "Unknown";
  const columns: ColumnSpec<PtoRequest>[] = [
    {
      id: "employee",
      header: "Employee",
      value: (p) => nameOf(p.employeeId),
      cell: (p) => <span className="font-medium">{nameOf(p.employeeId)}</span>,
    },
    { id: "kind", header: "Kind", value: (p) => KINDS[p.kind] },
    { id: "start", header: "From", value: (p) => p.start, cell: (p) => formatDate(p.start) },
    { id: "end", header: "To", value: (p) => p.end, cell: (p) => formatDate(p.end) },
    { id: "hours", header: "Hours", kind: "quantity", value: (p) => p.hours },
    { id: "note", header: "Note", value: (p) => p.note, hidden: true },
    {
      id: "status",
      header: "Status",
      value: (p) => STATUS[p.status].label,
      cell: (p) =>
        p.status === "pending" && canDecide ? (
          <span className="flex gap-1.5">
            <Button size="sm" variant="outline" onClick={() => void decide(p, "approved", nameOf(p.employeeId))}>
              <Check />
              Approve
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void decide(p, "denied", nameOf(p.employeeId))}>
              <X />
              Deny
            </Button>
          </span>
        ) : (
          <StatusPill {...STATUS[p.status]} />
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title={product.key === "hr" ? "Time off" : "HR"}
        actions={
          can("hr.pto.request") && user.employeeId ? (
            <Button onClick={() => setAsking(true)}>
              <CalendarPlus />
              Request time off
            </Button>
          ) : null
        }
      />
      <HrTabs />
      {data.status !== "ready" ? (
        <QueryFallback query={data} className="h-96" label="Loading time off" />
      ) : (
        <>
          <DataTable
            id="hr-time-off"
            rows={data.data.ptoRequests}
            columns={columns}
            getRowId={(p) => p.id}
            searchPlaceholder="Search requests"
            csvName="time-off"
            initialSort={{ id: "start", desc: true }}
            empty={{ message: "No time-off requests yet." }}
          />
          {user.employeeId ? (
            <p className="text-muted-foreground text-sm">
              Your balance:{" "}
              <Num
                kind="quantity"
                value={data.data.employees.find((e) => e.id === user.employeeId)?.ptoBalanceHours ?? "0"}
                unit="hours"
              />
            </p>
          ) : null}
        </>
      )}
      {user.employeeId ? <RequestDialog employeeId={user.employeeId} open={asking} onOpenChange={setAsking} /> : null}
    </>
  );
}
