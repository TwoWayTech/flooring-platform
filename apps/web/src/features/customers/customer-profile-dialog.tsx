"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  CUSTOMER_FIELD_MESSAGES,
  PAYMENT_TERM_LABELS,
  PAYMENT_TERMS,
  type Customer,
  type CustomerType,
  type PaymentTerms,
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Field } from "@/components/field";
import { api } from "@/lib/api";

const TYPES: Record<CustomerType, string> = { homeowner: "Homeowner", dealer: "Dealer", contractor: "Contractor" };

/** A complete enough profile; messages say what to fix (design brief "Copy"). */
const ProfileSchema = z
  .object({
    name: z.string().trim().min(1, "Enter the customer's name."),
    contactName: z.string().trim().min(1, "Enter who to speak to."),
    email: z.union([z.literal(""), z.email("Enter a valid email address.")]),
    phone: z.string().trim(),
    type: z.enum(["homeowner", "dealer", "contractor"]),
    terms: z.enum(PAYMENT_TERMS, CUSTOMER_FIELD_MESSAGES.terms),
  })
  .refine((v) => v.email.trim() !== "" || v.phone.trim().length >= 7, {
    path: ["phone"],
    message: "Enter a phone number or an email address so the customer can be reached.",
  });
type ProfileForm = z.infer<typeof ProfileSchema>;

/**
 * Completes or edits a customer's profile (spec A6): name, contact, a way to reach them, type
 * and terms. Validates inline and moves focus to the first field with an error.
 */
export function CustomerProfileDialog({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const form = useForm<ProfileForm>({
    resolver: zodResolver(ProfileSchema),
    defaultValues: {
      name: customer.name,
      contactName: customer.contactName,
      email: customer.email,
      phone: customer.phone,
      type: customer.type,
      terms: customer.terms,
    },
  });
  const { errors, isSubmitting } = form.formState;

  async function save(values: ProfileForm) {
    try {
      await api.saveCustomer({ ...customer, ...values });
      toast.success(`${values.name} saved`);
      onClose();
    } catch (e) {
      form.setError("root", { message: e instanceof Error ? e.message : "The customer was not saved." });
    }
  }

  const text = (name: "name" | "contactName" | "email" | "phone", label: string) => (
    <Field id={`profile-${name}`} label={label}>
      <Input
        id={`profile-${name}`}
        aria-invalid={!!errors[name]}
        aria-describedby={errors[name] ? `profile-${name}-error` : undefined}
        {...form.register(name)}
      />
      {errors[name] ? (
        <p id={`profile-${name}-error`} className="text-danger-ink text-xs">
          {errors[name]!.message}
        </p>
      ) : null}
    </Field>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={form.handleSubmit(save)} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Customer profile</DialogTitle>
            <DialogDescription>Add an address from the drawer to finish the profile.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            {text("name", "Name")}
            {text("contactName", "Contact")}
            {text("phone", "Phone")}
            {text("email", "Email")}
            <Field id="profile-type" label="Type">
              <Controller
                control={form.control}
                name="type"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="profile-type" className="w-full" ref={field.ref}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(TYPES) as CustomerType[]).map((t) => (
                        <SelectItem key={t} value={t}>
                          {TYPES[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field id="profile-terms" label="Payment terms">
              <Controller
                control={form.control}
                name="terms"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="profile-terms" className="w-full" ref={field.ref}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PAYMENT_TERM_LABELS) as PaymentTerms[]).map((t) => (
                        <SelectItem key={t} value={t}>
                          {PAYMENT_TERM_LABELS[t]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
          </div>
          {errors.root?.message ? (
            <p role="alert" className="text-danger-ink text-sm">
              {errors.root.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              Save profile
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
