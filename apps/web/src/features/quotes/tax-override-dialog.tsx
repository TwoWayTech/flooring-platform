"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { TaxOverride } from "@workspace/shared";
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
import { Textarea } from "@workspace/ui/components/textarea";
import { Field } from "@/components/field";
import { useWorkspace } from "@/components/workspace/workspace-context";

const OverrideSchema = z.object({
  ratePct: z
    .string()
    .trim()
    .regex(/^\d{1,2}(\.\d{1,4})?$/, "Enter a rate between 0 and 99.9999, for example 8.25."),
  reason: z.string().trim().min(3, "Say why the rate is different on this document."),
});
type OverrideForm = z.infer<typeof OverrideSchema>;

interface TaxOverrideDialogProps {
  open: boolean;
  /** The rate in use now, as the starting value. */
  currentRatePct: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (override: TaxOverride) => void;
}

/**
 * Changes the tax rate on one document (spec A5). Only people with sales.tax.override see it,
 * a reason is required, and saving the document writes the change to the audit log.
 */
export function TaxOverrideDialog({ open, currentRatePct, onOpenChange, onConfirm }: TaxOverrideDialogProps) {
  const { user } = useWorkspace();
  const form = useForm<OverrideForm>({
    resolver: zodResolver(OverrideSchema),
    defaultValues: { ratePct: currentRatePct, reason: "" },
  });
  const { errors } = form.formState;

  function submit(values: OverrideForm) {
    onConfirm({ ...values, byName: user.name, at: new Date().toISOString() });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-md">
        <form onSubmit={form.handleSubmit(submit)} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Change tax on this document</DialogTitle>
            <DialogDescription>
              The default rate stays for every other document. The change and the reason go to the audit log when you
              save.
            </DialogDescription>
          </DialogHeader>
          <Field id="override-rate" label="Rate">
            <span className="flex items-center gap-1.5">
              <Input
                id="override-rate"
                inputMode="decimal"
                className="w-28 text-right tabular-nums"
                aria-invalid={!!errors.ratePct}
                aria-describedby={errors.ratePct ? "override-rate-error" : undefined}
                {...form.register("ratePct")}
              />
              <span className="text-muted-foreground text-sm">%</span>
            </span>
            {errors.ratePct ? (
              <p id="override-rate-error" className="text-danger-ink text-xs">
                {errors.ratePct.message}
              </p>
            ) : null}
          </Field>
          <Field id="override-reason" label="Reason">
            <Textarea
              id="override-reason"
              rows={2}
              aria-invalid={!!errors.reason}
              aria-describedby={errors.reason ? "override-reason-error" : undefined}
              {...form.register("reason")}
            />
            {errors.reason ? (
              <p id="override-reason-error" className="text-danger-ink text-xs">
                {errors.reason.message}
              </p>
            ) : null}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Use this rate</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
