"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Send } from "lucide-react";
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

interface SendQuoteDialogProps {
  /** The suggested expiry date: today plus the company's expiry days. */
  defaultExpiry: string;
  today: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (expiresAt: string | null) => void;
}

/**
 * Marks a quote as sent to the customer (spec B1): it becomes Pending, with an optional expiry
 * date after which it reads Expired. The rest of the quote was validated before this opens.
 */
export function SendQuoteDialog({ defaultExpiry, today, pending, onOpenChange, onSend }: SendQuoteDialogProps) {
  const schema = z.object({
    expiresAt: z
      .string()
      .refine((v) => v === "" || v >= today, "The expiry date can't be in the past. Leave it empty for no expiry."),
  });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { expiresAt: defaultExpiry },
  });
  const error = form.formState.errors.expiresAt?.message;

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-md">
        <form
          onSubmit={form.handleSubmit(({ expiresAt }) => onSend(expiresAt || null))}
          className="flex flex-col gap-4"
          noValidate
        >
          <DialogHeader>
            <DialogTitle>Send quote</DialogTitle>
            <DialogDescription>
              The quote is marked Pending while the customer decides. After the expiry date it reads Expired.
            </DialogDescription>
          </DialogHeader>
          <Field id="quote-expires" label="Valid until (optional)">
            <Input
              id="quote-expires"
              type="date"
              min={today}
              className="w-44"
              aria-invalid={!!error}
              aria-describedby={error ? "quote-expires-error" : undefined}
              {...form.register("expiresAt")}
            />
            {error ? (
              <p id="quote-expires-error" className="text-danger-ink text-xs">
                {error}
              </p>
            ) : null}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              <Send />
              Mark as pending
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
