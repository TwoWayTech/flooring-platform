"use client";

import { useRef, useState, type ReactNode } from "react";
import { CircleCheck, FileText, Pencil, TriangleAlert, Upload, UserMinus } from "lucide-react";
import { toast } from "sonner";
import {
  exemptSalaryWarning,
  SENSITIVE,
  stateName,
  tenure,
  timeOffBalances,
  type ChecklistItem,
  type Employee,
  type FileMeta,
  type Location,
  type TimeOffEntry,
  type TimeOffPolicy,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Num } from "@workspace/ui/components/num";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@workspace/ui/components/sheet";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { useCan } from "@/components/workspace/workspace-context";
import { FileViewerDialog } from "@/features/invoices/payments/file-viewer-dialog";
import { api } from "@/lib/api";
import { useFormatDate } from "@/lib/use-format-date";
import { EmployeeFormDialog } from "./employee-form-dialog";

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Checklist({
  title,
  items,
  disabled,
  onToggle,
}: {
  title: string;
  items: readonly ChecklistItem[];
  disabled: boolean;
  onToggle: (item: ChecklistItem, done: boolean) => void;
}) {
  if (items.length === 0) return null;
  const done = items.filter((i) => i.doneAt).length;
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">
        {title}{" "}
        <span className="text-muted-foreground font-normal">
          {done} of {items.length} done
        </span>
      </h3>
      <ul className="flex flex-col gap-2 text-sm">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2">
            <Checkbox
              id={item.id}
              checked={!!item.doneAt}
              disabled={disabled}
              onCheckedChange={(v) => onToggle(item, v === true)}
            />
            <label htmlFor={item.id}>{item.label}</label>
          </li>
        ))}
      </ul>
    </section>
  );
}

const FLSA: Record<Employee["flsaStatus"], string> = {
  non_exempt: "Non-exempt",
  exempt: "Exempt",
  not_applicable: "Not applicable",
};
const PAY_UNIT: Record<Employee["payType"], string> = { hourly: "per hour", salary: "per year", per_job: "per job" };

/** A person's profile (spec C1 People): job, pay (sensitive), balances, documents and checklists. */
export function EmployeeSheet({
  employee,
  employees,
  locations,
  policies,
  entries,
  onClose,
}: {
  employee: Employee;
  employees: readonly Employee[];
  locations: readonly Location[];
  policies: readonly TimeOffPolicy[];
  entries: readonly TimeOffEntry[];
  onClose: () => void;
}) {
  const can = useCan();
  const formatDate = useFormatDate();
  const [editing, setEditing] = useState(false);
  const [viewing, setViewing] = useState<FileMeta | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const canEdit = can("hr.employee.edit");
  const manager = employees.find((e) => e.id === employee.managerId);
  const location = locations.find((l) => l.id === employee.homeLocationId);
  const warning = exemptSalaryWarning(employee, api.today());
  const unconfirmed = employee.workerType === "1099" && employee.state === "CA" && employee.documents.length === 0;
  const balances =
    employee.workerType === "w2"
      ? timeOffBalances(entries, employee.id, policies).filter((b) => b.policy.accrualMethod !== "none")
      : [];

  async function toggle(list: "onboarding" | "offboarding", item: ChecklistItem, done: boolean) {
    await api.setChecklistItem(employee.id, list, item.id, done);
  }

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    try {
      await api.addEmployeeDocuments(employee.id, [...files]);
      toast.success("Document added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add this document.");
    }
  }

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="bg-surface w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{employee.name}</SheetTitle>
          <SheetDescription>
            {employee.title}, {employee.department}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 px-4 pb-6">
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Pencil />
                Edit
              </Button>
              {employee.status !== "terminated" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void api.startOffboarding(employee.id).then(() => toast.success("Offboarding started"))
                  }
                >
                  <UserMinus />
                  Start offboarding
                </Button>
              ) : null}
            </div>
          ) : null}
          {warning || unconfirmed ? (
            <p className="text-warning-ink bg-warning/14 flex gap-2 rounded-md p-3 text-sm">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {warning ??
                "Classification to confirm: no contract or license is on file for this California contractor."}
            </p>
          ) : null}
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Fact label="Employment">{employee.workerType === "w2" ? "W-2" : "1099 contractor"}</Fact>
            <Fact label="Overtime status">{FLSA[employee.flsaStatus]}</Fact>
            <Fact label="Manager">{manager?.name ?? "None"}</Fact>
            <Fact label="Home location">{location?.name ?? "Not set"}</Fact>
            <Fact label="Works in">{stateName(employee.state)}</Fact>
            <Fact label="Started">
              {formatDate(employee.hiredAt)} ({tenure(employee.hiredAt, api.today())})
            </Fact>
            {can(SENSITIVE.payRate) ? (
              <Fact label="Pay rate">
                <Num kind="money" value={employee.payRate} /> {PAY_UNIT[employee.payType]}
              </Fact>
            ) : null}
            <Fact label="Email">{employee.email}</Fact>
            <Fact label="Phone">{employee.phone}</Fact>
            <Fact label="Emergency contact">
              {employee.emergencyContact
                ? `${employee.emergencyContact.name}, ${employee.emergencyContact.phone}`
                : "Not on file"}
            </Fact>
          </dl>
          {balances.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Time-off balances</h3>
              <ul className="flex flex-col gap-1 text-sm">
                {balances.map((b) => (
                  <li key={b.policy.id} className="flex justify-between gap-3">
                    <span>{b.policy.name}</span>
                    <Num kind="quantity" value={b.hours.toString()} unit="hours" />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium">Documents</h3>
              {canEdit ? (
                <>
                  <input
                    ref={fileInput}
                    type="file"
                    multiple
                    className="sr-only"
                    aria-label="Add a document"
                    onChange={(e) => void upload(e.target.files)}
                  />
                  <Button size="sm" variant="ghost" onClick={() => fileInput.current?.click()}>
                    <Upload />
                    Add
                  </Button>
                </>
              ) : null}
            </div>
            {employee.documents.length === 0 ? (
              <p className="text-muted-foreground text-sm">No documents yet.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {employee.documents.map((d) => (
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
          </section>
          <Checklist
            title="Onboarding"
            items={employee.onboarding}
            disabled={!canEdit}
            onToggle={(i, d) => void toggle("onboarding", i, d)}
          />
          <Checklist
            title="Offboarding"
            items={employee.offboarding}
            disabled={!canEdit}
            onToggle={(i, d) => void toggle("offboarding", i, d)}
          />
          {employee.status !== "active" ? (
            <StatusPill
              tone="neutral"
              icon={CircleCheck}
              label={employee.status === "on_leave" ? "On leave" : "Left the company"}
            />
          ) : null}
        </div>
        {editing ? (
          <EmployeeFormDialog
            employee={employee}
            employees={employees}
            locations={locations}
            onClose={() => setEditing(false)}
          />
        ) : null}
        {viewing ? <FileViewerDialog file={viewing} onClose={() => setViewing(null)} /> : null}
      </SheetContent>
    </Sheet>
  );
}
