"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { featureOn, stateName, tenure, type FileMeta } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { Field } from "@/components/field";
import { NoAccess } from "@/components/no-access";
import { QueryFallback } from "@/components/query-fallback";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { FileViewerDialog } from "@/features/invoices/payments/file-viewer-dialog";
import { RequestMeetingDialog } from "@/features/meetings/meeting-answers";
import { api } from "@/lib/api";
import type { MyPortal } from "@/lib/api/contract";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { MyShell } from "./my-shell";

function Documents({ portal }: { portal: MyPortal }) {
  const [viewing, setViewing] = useState<FileMeta | null>(null);
  const docs = portal.employee?.documents ?? [];
  return (
    <Panel title="Documents on file">
      {docs.length === 0 ? (
        <p className="text-muted-foreground text-sm">Nothing on file yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {docs.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className="hover:text-brand-ink inline-flex items-center gap-2 underline-offset-2 hover:underline"
                onClick={() => setViewing(d)}
              >
                <FileText aria-hidden="true" className="size-4" />
                {d.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {viewing ? <FileViewerDialog file={viewing} onClose={() => setViewing(null)} /> : null}
    </Panel>
  );
}

/** My documents (spec C2). */
export function MyDocumentsPage() {
  return <MyShell title="My documents">{(p) => <Documents portal={p} />}</MyShell>;
}

/**
 * The person's coming meetings as the server lists them (GET /me/meetings): each with its next
 * occurrence, worked out in the meeting's own zone, soonest first. Request shows only when the
 * server names a colleague to ask (ADR 0051 "Part 3", safest option 9).
 */
function Meetings() {
  const formatDate = useFormatDate();
  const [requesting, setRequesting] = useState(false);
  const data = useApiQuery((client) => client.myMeetings(), [], { keepDataOnError: true });
  if (data.status !== "ready") return <QueryFallback query={data} className="h-40" label="Loading your meetings" />;
  const { meetings, colleagues } = data.data;
  return (
    <Panel
      title="Coming up"
      bodyClassName="p-0"
      actions={
        colleagues.length > 0 ? (
          <Button size="sm" variant="outline" onClick={() => setRequesting(true)}>
            Request a meeting
          </Button>
        ) : null
      }
    >
      {meetings.length === 0 ? (
        <p className="text-muted-foreground p-4 text-sm">No meetings coming up.</p>
      ) : (
        <ul className="divide-hairline divide-y text-sm">
          {meetings.slice(0, 20).map(({ meeting, next }) => (
            <li key={meeting.id} className="flex justify-between gap-3 px-4 py-2.5">
              <span>{meeting.title}</span>
              <span className="text-muted-foreground whitespace-nowrap">
                {formatDate(next.start.slice(0, 10))} at {next.start.slice(11, 16)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {requesting && colleagues.length > 0 ? (
        <RequestMeetingDialog colleagues={colleagues} onClose={() => setRequesting(false)} />
      ) : null}
    </Panel>
  );
}

/**
 * My meetings (spec C2): the person's own coming meetings. Hidden with `meetings.calendar` off or
 * without the meetings module, as the API refuses then (ADR 0051 "Part 3", safest option 10).
 */
export function MyMeetingsPage() {
  const { company } = useWorkspace();
  if (!featureOn("meetings.calendar")) return <NoAccess message="This feature is switched off in this demo." />;
  return (
    <MyShell title="My meetings">{() => (company.modules.includes("meetings") ? <Meetings /> : <NoAccess />)}</MyShell>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Profile({ portal }: { portal: MyPortal }) {
  const formatDate = useFormatDate();
  const employee = portal.employee!;
  const [phone, setPhone] = useState(employee.phone);
  const contact = employee.emergencyContact ?? { name: "", phone: "", relation: "" };
  const [contactName, setContactName] = useState(contact.name);
  const [contactPhone, setContactPhone] = useState(contact.phone);

  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await api.updateMyEmployeeProfile({
        phone,
        emergencyContact: { name: contactName, phone: contactPhone, relation: contact.relation },
      });
      toast.success("Profile saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save your profile.");
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Panel title={employee.name}>
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <Fact label="Job title">{employee.title}</Fact>
          <Fact label="Department">{employee.department}</Fact>
          <Fact label="Works in">{stateName(employee.state)}</Fact>
          <Fact label="Started">
            {formatDate(employee.hiredAt)} ({tenure(employee.hiredAt, api.today())})
          </Fact>
          <Fact label="Email">{employee.email}</Fact>
          {portal.visible.rates ? (
            <Fact label="Pay rate">
              <Num kind="money" value={employee.payRate} />
            </Fact>
          ) : null}
        </dl>
      </Panel>
      <Panel title="Your contact details">
        <form onSubmit={save} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field id="my-phone" label="Phone">
              <Input id="my-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
            <Field id="my-ec-name" label="Emergency contact">
              <Input id="my-ec-name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
            </Field>
            <Field id="my-ec-phone" label="Emergency phone">
              <Input id="my-ec-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
            </Field>
          </div>
          <div>
            <Button type="submit">Save</Button>
          </div>
        </form>
      </Panel>
    </div>
  );
}

/** My profile (spec C2). */
export function MyProfilePage() {
  return (
    <MyShell title="My profile">
      {(p) =>
        p.employee ? (
          <Profile portal={p} />
        ) : (
          <p className="text-muted-foreground">Your sign-in is not linked to an employee record.</p>
        )
      }
    </MyShell>
  );
}

function Payments({ portal }: { portal: MyPortal }) {
  const formatDate = useFormatDate();
  return (
    <Panel title="Payments" bodyClassName="p-0">
      {portal.contractorPayments.length === 0 ? (
        <p className="text-muted-foreground p-4 text-sm">No payments yet.</p>
      ) : (
        <ul className="divide-hairline divide-y text-sm">
          {portal.contractorPayments.map((p) => (
            <li key={p.id} className="flex justify-between gap-3 px-4 py-2.5">
              <span>
                {p.description}, {formatDate(p.date)}
                <span className="text-muted-foreground"> {p.status === "paid" ? "Paid" : "Approved"}</span>
              </span>
              <Num kind="money" value={p.amount} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** My payments for 1099 contractors (ADR 0024): no timesheet, time off or pay pages. */
export function MyPaymentsPage() {
  return <MyShell title="My payments">{(p) => <Payments portal={p} />}</MyShell>;
}
