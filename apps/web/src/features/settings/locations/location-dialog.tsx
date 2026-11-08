"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { US_STATES, ZIP_PATTERN, type Branch, type Location } from "@workspace/shared";
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
import { Segmented } from "@workspace/ui/components/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Switch } from "@workspace/ui/components/switch";
import { Field } from "@/components/field";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { AddressSearchField } from "@/components/address/address-search-field";
import { fillAddress } from "@/components/address/fill-address";

const STATE_CODES = US_STATES.map(([code]) => code) as [string, ...string[]];

/** A valid location; messages say what to fix (design brief "Copy"). */
const LocationSchema = z.object({
  name: z.string().trim().min(1, "Enter a name people will recognise, such as Denver Central."),
  kind: z.enum(["warehouse", "showroom"]),
  branchId: z.string().min(1, "Choose the branch this location belongs to."),
  address: z.object({
    street: z.string().trim().min(1, "Enter the street address."),
    city: z.string().trim().min(1, "Enter the city."),
    state: z.enum(STATE_CODES, "Use a two-letter state code, for example CO."),
    zip: z.string().regex(ZIP_PATTERN, "Enter a ZIP such as 80202 or 80202-1234."),
    county: z.string().trim(),
  }),
  isDefault: z.boolean(),
  displaySamples: z.number().int("Enter a whole number.").min(0, "Enter zero or more."),
});

type LocationForm = z.infer<typeof LocationSchema>;

const KINDS = [
  ["warehouse", "Warehouse"],
  ["showroom", "Showroom"],
] as const;

/** Adds or edits a warehouse or showroom; the store keeps one default warehouse (spec A1). */
export function LocationDialog({
  location,
  branches,
  onClose,
}: {
  location: Location | null;
  branches: Branch[];
  onClose: () => void;
}) {
  const { company } = useWorkspace();
  const form = useForm<LocationForm>({
    resolver: zodResolver(LocationSchema),
    defaultValues: location
      ? { ...location, address: { county: "", ...location.address } }
      : {
          name: "",
          kind: "warehouse",
          branchId: branches[0]?.id ?? "",
          address: { street: "", city: "", state: company.state, zip: "", county: "" },
          isDefault: false,
          displaySamples: 0,
        },
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  const { errors } = form.formState;

  async function save(values: LocationForm) {
    const id = location?.id ?? `${company.id}-loc-${crypto.randomUUID().slice(0, 8)}`;
    try {
      const saved = await api.saveLocation({
        ...values,
        id,
        isDefault: values.kind === "warehouse" && values.isDefault,
        displaySamples: values.kind === "showroom" ? values.displaySamples : 0,
      });
      toast.success(`${saved.name} saved`);
      onClose();
    } catch (e) {
      form.setError("root", { message: e instanceof Error ? e.message : "The location was not saved." });
    }
  }

  const text = (
    name: "name" | "address.street" | "address.city" | "address.state" | "address.zip" | "address.county",
  ) => {
    const [head, tail] = name.split(".") as ["name" | "address", string | undefined];
    const error = tail ? (errors.address as Record<string, { message?: string }> | undefined)?.[tail] : errors[head];
    return {
      ...form.register(name),
      "aria-invalid": !!error,
      "aria-describedby": error ? `loc-${name}-error` : undefined,
    };
  };
  const errorText = (name: string, message?: string) =>
    message ? (
      <p id={`loc-${name}-error`} className="text-danger-ink text-xs">
        {message}
      </p>
    ) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={form.handleSubmit(save)} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{location ? `Edit ${location.name}` : "Add a location"}</DialogTitle>
            <DialogDescription>Warehouses hold sellable stock; showrooms only display samples.</DialogDescription>
          </DialogHeader>
          <Field id="loc-name" label="Name">
            <Input id="loc-name" {...text("name")} />
            {errorText("name", errors.name?.message)}
          </Field>
          <Controller
            control={form.control}
            name="kind"
            render={({ field }) => (
              <Segmented label="Type" options={KINDS} value={field.value} onChange={field.onChange} />
            )}
          />
          <Field id="loc-branch" label="Branch">
            <Controller
              control={form.control}
              name="branchId"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="loc-branch" className="w-full" ref={field.ref}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
            {errorText("branchId", errors.branchId?.message)}
          </Field>
          <AddressSearchField
            id="loc-address-search"
            near={company.state}
            onSelect={(address) => fillAddress(form.setValue, address)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="loc-address.street" label="Street" className="sm:col-span-2">
              <Input id="loc-address.street" {...text("address.street")} />
              {errorText("address.street", errors.address?.street?.message)}
            </Field>
            <Field id="loc-address.city" label="City">
              <Input id="loc-address.city" {...text("address.city")} />
              {errorText("address.city", errors.address?.city?.message)}
            </Field>
            <Field id="loc-address.state" label="State">
              <Input id="loc-address.state" maxLength={2} {...text("address.state")} />
              {errorText("address.state", errors.address?.state?.message)}
            </Field>
            <Field id="loc-address.zip" label="ZIP">
              <Input id="loc-address.zip" inputMode="numeric" {...text("address.zip")} />
              {errorText("address.zip", errors.address?.zip?.message)}
            </Field>
            <Field id="loc-address.county" label="County">
              <Input id="loc-address.county" {...text("address.county")} />
            </Field>
          </div>
          {kind === "warehouse" ? (
            <Controller
              control={form.control}
              name="isDefault"
              render={({ field }) => (
                <label className="flex items-start gap-3 text-sm">
                  <Switch checked={field.value} onCheckedChange={field.onChange} aria-describedby="loc-default-hint" />
                  <span>
                    Company default warehouse
                    <span id="loc-default-hint" className="text-muted-foreground block text-xs">
                      Used for new documents when a person has no default warehouse of their own.
                    </span>
                  </span>
                </label>
              )}
            />
          ) : (
            <Field
              id="loc-samples"
              label="Display samples"
              hint="A count of samples on the floor; never sellable stock."
            >
              <Input
                id="loc-samples"
                inputMode="numeric"
                aria-describedby="loc-samples-hint"
                {...form.register("displaySamples", { valueAsNumber: true })}
              />
              {errorText("displaySamples", errors.displaySamples?.message)}
            </Field>
          )}
          {errors.root?.message ? (
            <p role="alert" className="text-danger-ink text-sm">
              {errors.root.message}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              Save location
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
