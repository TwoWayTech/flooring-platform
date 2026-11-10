"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { SENSITIVE, US_STATES, type Employee, type Location } from "@workspace/shared";
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
import { Field } from "@/components/field";
import { useCan } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import type { EmployeeInput } from "@/lib/api/contract";
import { Pick } from "./pick";

const WORKER = [
  ["w2", "W-2 employee"],
  ["1099", "1099 contractor"],
] as const;
const PAY = [
  ["hourly", "Hourly"],
  ["salary", "Salary per year"],
  ["per_job", "Per job"],
] as const;
const FLSA = [
  ["non_exempt", "Non-exempt (overtime applies)"],
  ["exempt", "Exempt"],
] as const;
const BASIS = [
  ["executive", "Executive"],
  ["administrative", "Administrative"],
  ["professional", "Professional"],
  ["outside_sales", "Outside sales"],
] as const;
const STATUS = [
  ["active", "Active"],
  ["on_leave", "On leave"],
  ["terminated", "Left the company"],
] as const;
const COMMISSION = [
  ["follow", "Follow the company setting"],
  ["show", "Show to this person"],
  ["hide", "Hide from this person"],
] as const;
const NONE = "none";

const blank = (today: string): EmployeeInput => ({
  name: "",
  title: "",
  department: "",
  workerType: "w2",
  payType: "hourly",
  payRate: "0.00",
  state: "CO",
  email: "",
  phone: "",
  hiredAt: today,
  status: "active",
  managerId: null,
  flsaStatus: "non_exempt",
  exemptionBasis: null,
  salaryHoursPerWeek: 40,
  commissionVisible: null,
  homeLocationId: null,
  emergencyContact: null,
});

/** Adds or edits a person's HR record (spec C1 People); pay needs hr.employee.view_sensitive. */
export function EmployeeFormDialog({
  employee,
  employees,
  locations,
  onClose,
}: {
  employee: Employee | null;
  employees: readonly Employee[];
  locations: readonly Location[];
  onClose: () => void;
}) {
  const can = useCan();
  const [draft, setDraft] = useState<EmployeeInput>(employee ?? blank(api.today()));
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<EmployeeInput>) => setDraft({ ...draft, ...patch });
  const contact = draft.emergencyContact ?? { name: "", phone: "", relation: "" };
  const setContact = (patch: Partial<typeof contact>) => set({ emergencyContact: { ...contact, ...patch } });

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      await api.saveEmployee({ ...draft, id: employee?.id });
      toast.success(employee ? "Changes saved" : `${draft.name} added`);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this person.");
    }
  }

  const commission = draft.commissionVisible === null ? "follow" : draft.commissionVisible ? "show" : "hide";
  const text = (id: keyof EmployeeInput, label: string, type = "text") => (
    <Field id={`emp-${id}`} label={label}>
      <Input
        id={`emp-${id}`}
        type={type}
        value={String(draft[id] ?? "")}
        onChange={(e) => set({ [id]: e.target.value })}
      />
    </Field>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{employee ? `Edit ${employee.name}` : "Add a person"}</DialogTitle>
            <DialogDescription>Pay rate and tax status are used for pay periods.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {text("name", "Full name")}
            {text("title", "Job title")}
            {text("department", "Department")}
            <Field id="emp-manager" label="Manager">
              <Pick
                id="emp-manager"
                value={draft.managerId ?? NONE}
                onChange={(v) => set({ managerId: v === NONE ? null : v })}
                options={[
                  [NONE, "No manager"],
                  ...employees.filter((e) => e.id !== employee?.id).map((e) => [e.id, e.name] as const),
                ]}
              />
            </Field>
            <Field id="emp-location" label="Home location">
              <Pick
                id="emp-location"
                value={draft.homeLocationId ?? NONE}
                onChange={(v) => set({ homeLocationId: v === NONE ? null : v })}
                options={[[NONE, "Not set"], ...locations.map((l) => [l.id, l.name] as const)]}
              />
            </Field>
            <Field id="emp-state" label="Work state">
              <Pick id="emp-state" value={draft.state} onChange={(state) => set({ state })} options={US_STATES} />
            </Field>
            <Field id="emp-worker" label="Employment type">
              <Pick
                id="emp-worker"
                value={draft.workerType}
                onChange={(workerType) => set({ workerType })}
                options={WORKER}
              />
            </Field>
            <Field id="emp-status" label="Status">
              <Pick id="emp-status" value={draft.status} onChange={(status) => set({ status })} options={STATUS} />
            </Field>
            {text("hiredAt", "Start date", "date")}
            <Field id="emp-pay" label="Pay type">
              <Pick id="emp-pay" value={draft.payType} onChange={(payType) => set({ payType })} options={PAY} />
            </Field>
            {can(SENSITIVE.payRate)
              ? text("payRate", draft.payType === "salary" ? "Salary per year" : "Pay rate")
              : null}
            {draft.workerType === "w2" ? (
              <Field id="emp-flsa" label="Overtime status">
                <Pick
                  id="emp-flsa"
                  value={draft.flsaStatus === "exempt" ? "exempt" : "non_exempt"}
                  onChange={(flsaStatus) => set({ flsaStatus })}
                  options={FLSA}
                />
              </Field>
            ) : null}
            {draft.flsaStatus === "exempt" ? (
              <Field id="emp-basis" label="Exemption">
                <Pick
                  id="emp-basis"
                  value={draft.exemptionBasis ?? "administrative"}
                  onChange={(exemptionBasis) => set({ exemptionBasis })}
                  options={BASIS}
                />
              </Field>
            ) : null}
            <Field id="emp-commission" label="Commission in the portal">
              <Pick
                id="emp-commission"
                value={commission}
                onChange={(v) => set({ commissionVisible: v === "follow" ? null : v === "show" })}
                options={COMMISSION}
              />
            </Field>
            {text("email", "Work email", "email")}
            {text("phone", "Phone")}
            <Field id="emp-ec-name" label="Emergency contact">
              <Input id="emp-ec-name" value={contact.name} onChange={(e) => setContact({ name: e.target.value })} />
            </Field>
            <Field id="emp-ec-phone" label="Emergency phone">
              <Input id="emp-ec-phone" value={contact.phone} onChange={(e) => setContact({ phone: e.target.value })} />
            </Field>
          </div>
          {error ? (
            <p role="alert" className="text-danger-ink text-sm">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">{employee ? "Save changes" : "Add person"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
