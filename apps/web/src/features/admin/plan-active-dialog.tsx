"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { adminReasonProblem, type PlatformPlan } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { StepUpDialog } from "@/components/step-up-dialog";
import { api } from "@/lib/api";
import { apiErrorCode } from "@/lib/api/errors";
import { isDemoMode } from "@/lib/data-source";
import { ReasonField } from "./reason-field";

/** What retiring or restoring a plan does, in words (docs/specs/platform-admin.md, part 2, "Retire and Restore"). */
export function planActiveText(plan: Pick<PlatformPlan, "name" | "active">): { title: string; body: string } {
  return plan.active
    ? {
        title: `Retire ${plan.name}?`,
        body: `Retiring hides nothing and changes no company today: companies on ${plan.name} keep it. It marks the plan as not offered for new subscriptions, which the console can't create yet.`,
      }
    : {
        title: `Restore ${plan.name}?`,
        body: "Restoring marks the plan as offered again. It changes no company.",
      };
}

interface PlanActiveDialogProps {
  plan: PlatformPlan;
  onClose: () => void;
}

/**
 * Retire or restore a plan (docs/specs/platform-admin.md, part 2, "Retire and Restore"): the reason,
 * checked with the shared rule before anything is sent, then the step-up in api mode. Neither
 * changes a company. A 409 (another admin did it first) shows its message and closes, and the plans
 * read again (ADR 0051, 2026-11-16); any other failure brings the form back with the reason kept.
 */
export function PlanActiveDialog({ plan, onClose }: PlanActiveDialogProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<"form" | "confirm">("form");
  const [pending, setPending] = useState(false);
  const text = planActiveText(plan);
  const verb = plan.active ? "Retire" : "Restore";

  async function send() {
    setPending(true);
    try {
      if (plan.active) await api.retirePlatformPlan(plan.id, reason.trim());
      else await api.restorePlatformPlan(plan.id, reason.trim());
      toast.success(plan.active ? "Plan retired." : "Plan restored.");
      onClose();
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "The plan was not changed.");
      if (apiErrorCode(failure) === "conflict") {
        onClose();
      } else {
        setStage("form");
      }
    } finally {
      setPending(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = adminReasonProblem(reason);
    if (problem) {
      setError(problem);
      document.getElementById("plan-active-reason")?.focus();
      return;
    }
    setError(null);
    if (isDemoMode()) void send();
    else setStage("confirm");
  }

  return (
    <>
      <Dialog open={stage === "form"} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <form onSubmit={submit} noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{text.title}</DialogTitle>
              <DialogDescription>{text.body}</DialogDescription>
            </DialogHeader>
            <ReasonField idPrefix="plan-active" value={reason} onChange={setReason} error={error} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {verb}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <StepUpDialog
        open={stage === "confirm"}
        action={`${verb} plan ${plan.name}`}
        onOpenChange={(open) => !open && setStage("form")}
        onConfirm={send}
      />
    </>
  );
}
