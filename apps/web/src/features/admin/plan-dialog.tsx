"use client";

import { useState, type FormEvent } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import {
  formatNumber,
  moduleInfo,
  PLAN_MESSAGES,
  PRODUCT_LABELS,
  type ModuleKey,
  type PlatformPlan,
  type ProductKey,
} from "@workspace/shared";
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
import { Label } from "@workspace/ui/components/label";
import { useNumberSettings } from "@workspace/ui/components/number-settings";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Switch } from "@workspace/ui/components/switch";
import { StepUpDialog } from "@/components/step-up-dialog";
import { api } from "@/lib/api";
import { isDemoMode } from "@/lib/data-source";
import {
  emptyPlanDraft,
  newPlanStep,
  planDraftOf,
  planFieldOf,
  planModuleChoices,
  planPatchStep,
  type PlanDraft,
  type PlanField,
} from "./plan-draft";
import { ReasonField } from "./reason-field";

/** What the plan dialog opens on: a new plan, or an existing one to change. */
export type PlanDialogTarget = { kind: "new" } | { kind: "edit"; plan: PlatformPlan };

/** A refusal shown in the form: on a field, or about the whole plan when `field` is null. */
export interface PlanFormError {
  field: PlanField | null;
  message: string;
}

const PRODUCTS: readonly ProductKey[] = ["flooring", "hr"];

/** The id of a field's control; the module switches share a group. */
function fieldId(field: PlanField): string {
  return `plan-${field}`;
}

/** Moves focus to the field a refusal points at: the control, or the first switch of the modules. */
function focusField(field: PlanField | null) {
  if (field === null) return;
  const target =
    field === "modules"
      ? document.querySelector<HTMLElement>(`#${fieldId("modules")} button:not([disabled])`)
      : document.getElementById(fieldId(field));
  target?.focus();
}

interface FieldErrorProps {
  field: PlanField;
  error: PlanFormError | null;
}

/** The refusal under a field, when it points at that field. */
function FieldError({ field, error }: FieldErrorProps) {
  if (error?.field !== field) return null;
  return (
    <p id={`${fieldId(field)}-error`} className="text-danger-ink text-xs">
      {error.message}
    </p>
  );
}

/** The control's invalid mark and description for a field. */
function invalidProps(field: PlanField, error: PlanFormError | null, hintId?: string) {
  const invalid = error?.field === field;
  const describedBy = [hintId, invalid ? `${fieldId(field)}-error` : undefined].filter(Boolean).join(" ");
  return { "aria-invalid": invalid ? true : undefined, "aria-describedby": describedBy || undefined };
}

interface PlanFormFieldsProps {
  target: PlanDialogTarget;
  draft: PlanDraft;
  error: PlanFormError | null;
  onChange: (draft: PlanDraft) => void;
}

/**
 * The plan form's fields (docs/specs/platform-admin.md, part 2, "The plan dialog"): the key and
 * product on create only, the name, both prices as typed (`inputMode="decimal"`), a switch per
 * visible module of the product with Platform on and fixed, both limits and the reason. A plan in
 * use keeps its modules and limits, so those controls are disabled with the reason why, and a note
 * says what a rename and a price change reach.
 */
export function PlanFormFields({ target, draft, error, onChange }: PlanFormFieldsProps) {
  const settings = useNumberSettings();
  const plan = target.kind === "edit" ? target.plan : null;
  const inUse = plan !== null && plan.companies > 0;
  const choices = planModuleChoices(draft.product);
  const set = (patch: Partial<PlanDraft>) => onChange({ ...draft, ...patch });
  const toggle = (module: ModuleKey, on: boolean) =>
    set({ modules: on ? [...draft.modules, module] : draft.modules.filter((m) => m !== module) });
  const companies = plan ? formatNumber(plan.companies, "count", settings) : "";

  return (
    <div className="flex flex-col gap-4">
      {error && error.field === null ? (
        <p role="alert" className="bg-danger/12 text-danger-ink rounded-md px-3 py-2 text-sm">
          {error.message}
        </p>
      ) : null}
      {plan ? (
        // The key and the product never change, so they are read, not offered as fields.
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-muted-foreground text-xs">Key</dt>
            <dd className="break-all">{plan.key}</dd>
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <dt className="text-muted-foreground text-xs">Product</dt>
            <dd>{PRODUCT_LABELS[plan.product]}</dd>
          </div>
        </dl>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId("key")}>Key</Label>
            <Input
              id={fieldId("key")}
              value={draft.key}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => set({ key: e.target.value })}
              {...invalidProps("key", error, `${fieldId("key")}-hint`)}
            />
            <p id={`${fieldId("key")}-hint`} className="text-muted-foreground text-xs">
              Such as flooring-pro. It can&apos;t change or be used again.
            </p>
            <FieldError field="key" error={error} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={fieldId("product")}>Product</Label>
            <Select
              // "" shows the placeholder and keeps the Select controlled from the start.
              value={draft.product}
              onValueChange={(product) => {
                const chosen = PRODUCTS.find((p) => p === product);
                // Another product offers other modules, so the choice starts again (none is invented).
                if (chosen) set({ product: chosen, modules: [] });
              }}
            >
              <SelectTrigger id={fieldId("product")} className="w-full" {...invalidProps("product", error)}>
                <SelectValue placeholder="Choose a product" />
              </SelectTrigger>
              <SelectContent>
                {PRODUCTS.map((product) => (
                  <SelectItem key={product} value={product}>
                    {PRODUCT_LABELS[product]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError field="product" error={error} />
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId("name")}>Name</Label>
        <Input
          id={fieldId("name")}
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          {...invalidProps("name", error)}
        />
        <FieldError field="name" error={error} />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="grid gap-4 sm:grid-cols-2">
          {(["monthlyPrice", "yearlyPrice"] as const).map((field) => (
            <div key={field} className="flex flex-col gap-1.5">
              <Label htmlFor={fieldId(field)}>{field === "monthlyPrice" ? "Monthly price" : "Yearly price"}</Label>
              <Input
                id={fieldId(field)}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={draft[field]}
                onChange={(e) => set({ [field]: e.target.value })}
                {...invalidProps(field, error, "plan-price-hint")}
              />
              <FieldError field={field} error={error} />
            </div>
          ))}
        </div>
        <p id="plan-price-hint" className="text-muted-foreground text-xs">
          Digits with up to two decimals, such as 49.00. A price is data: nothing is charged from it.
        </p>
      </div>
      {inUse ? (
        <div
          role="note"
          className="border-hairline bg-raised text-muted-foreground flex flex-col gap-1 rounded-md border px-3 py-2 text-sm"
        >
          <p className="text-foreground flex items-start gap-2 font-medium">
            <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            In use by {companies} {plan.companies === 1 ? "company" : "companies"}: its modules and limits can&apos;t
            change. Change one company&apos;s access on its Access page.
          </p>
          <p>{PLAN_MESSAGES.inUseEffect}</p>
        </div>
      ) : null}
      <fieldset
        id={fieldId("modules")}
        className="flex flex-col gap-1.5"
        aria-describedby={error?.field === "modules" ? `${fieldId("modules")}-error` : undefined}
      >
        <legend className="mb-1.5 text-sm font-medium">Modules</legend>
        {choices.length === 0 ? (
          <p className="text-muted-foreground text-sm">Choose a product to see its modules.</p>
        ) : (
          <ul className="border-hairline divide-hairline divide-y rounded-md border">
            <li className="flex items-center justify-between gap-4 px-3 py-2">
              <span className="text-sm font-medium">{moduleInfo("platform").label}</span>
              <Switch aria-label="Platform module, always on" checked disabled />
            </li>
            {choices.map((module) => {
              const info = moduleInfo(module);
              return (
                <li key={module} className="flex items-center justify-between gap-4 px-3 py-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{info.label}</span>
                    <span className="text-muted-foreground block text-xs">{info.description}</span>
                  </span>
                  <Switch
                    aria-label={`${info.label} module`}
                    checked={draft.modules.includes(module)}
                    disabled={inUse}
                    onCheckedChange={(on) => toggle(module, on)}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <FieldError field="modules" error={error} />
      </fieldset>
      <div className="flex flex-col gap-1.5">
        <div className="grid gap-4 sm:grid-cols-2">
          {(["maxUsers", "maxBranches"] as const).map((field) => {
            const stored = plan?.[field] ?? null;
            return (
              <div key={field} className="flex flex-col gap-1.5">
                <Label htmlFor={fieldId(field)}>{field === "maxUsers" ? "User limit" : "Branch limit"}</Label>
                <Input
                  id={fieldId(field)}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={plan && stored === null ? "No limit" : undefined}
                  value={draft[field]}
                  disabled={inUse}
                  onChange={(e) => set({ [field]: e.target.value })}
                  {...invalidProps(field, error, "plan-limit-hint")}
                />
                <FieldError field={field} error={error} />
              </div>
            );
          })}
        </div>
        <p id="plan-limit-hint" className="text-muted-foreground text-xs">
          Whole numbers from {formatNumber(1, "count", settings)} to {formatNumber(100000, "count", settings)}.
        </p>
      </div>
      <ReasonField
        idPrefix="plan"
        value={draft.reason}
        onChange={(reason) => set({ reason })}
        error={error?.field === "reason" ? error.message : null}
      />
    </div>
  );
}

interface PlanDialogProps {
  target: PlanDialogTarget;
  onClose: () => void;
}

/**
 * Create or change a plan (docs/specs/platform-admin.md, part 2, "The plan dialog"). Continue runs
 * the shared rules first: a field in error is marked, described and focused, and no code is asked
 * for. In api mode the step-up follows, as every platform write needs; the demo saves at once. A
 * refusal shows its message and brings the form back with what was typed.
 */
export function PlanDialog({ target, onClose }: PlanDialogProps) {
  const [draft, setDraft] = useState<PlanDraft>(() =>
    target.kind === "edit" ? planDraftOf(target.plan) : emptyPlanDraft(),
  );
  const [error, setError] = useState<PlanFormError | null>(null);
  const [stage, setStage] = useState<"form" | "confirm">("form");
  const [pending, setPending] = useState(false);
  const [send, setSend] = useState<(() => Promise<unknown>) | null>(null);
  const editing = target.kind === "edit";
  const name = draft.name.trim() || (editing ? target.plan.name : "");

  async function run(call: () => Promise<unknown>) {
    setPending(true);
    try {
      await call();
      toast.success(editing ? "Plan saved." : "Plan created.");
      onClose();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "The plan was not saved.";
      toast.error(message);
      setError({ field: planFieldOf(message, draft), message });
      setStage("form");
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    let call: () => Promise<unknown>;
    if (target.kind === "edit") {
      const step = planPatchStep(target.plan, draft);
      if (!step.ok) return refuse(step.field, step.message);
      const patch = step.value;
      if (patch === null) {
        toast.info("Nothing changed, so nothing was saved.");
        onClose();
        return;
      }
      call = () => api.updatePlatformPlan(target.plan.id, patch);
    } else {
      const step = newPlanStep(draft);
      if (!step.ok) return refuse(step.field, step.message);
      const input = step.value;
      call = () => api.createPlatformPlan(input);
    }
    setError(null);
    if (isDemoMode()) {
      void run(call);
    } else {
      setSend(() => call);
      setStage("confirm");
    }
  }

  function refuse(field: PlanField | null, message: string) {
    setError({ field, message });
    // After the render that marks the field, so the error is read with it.
    setTimeout(() => focusField(field), 0);
  }

  return (
    <>
      <Dialog open={stage === "form"} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{editing ? `Change ${target.plan.name}` : "New plan"}</DialogTitle>
              <DialogDescription>
                {editing
                  ? "Its key and product stay as they are."
                  : "Every field is needed: no price, module or limit is filled in for you."}
              </DialogDescription>
            </DialogHeader>
            <PlanFormFields target={target} draft={draft} error={error} onChange={setDraft} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                Continue
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <StepUpDialog
        open={stage === "confirm"}
        action={editing ? `Save plan ${name}` : `Create plan ${name}`}
        onOpenChange={(open) => !open && setStage("form")}
        onConfirm={() => (send ? run(send) : undefined)}
      />
    </>
  );
}
