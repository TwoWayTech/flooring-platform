"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  ADDRESS_MAX,
  DISPLAY_SAMPLES_MAX,
  LOCATION_MESSAGES,
  LOCATION_NAME_MAX,
  locationProblem,
  PROFILE_MESSAGES,
  QUANTITY_TEXT,
  QUANTITY_TEXT_MAX,
  US_STATES,
  ZIP_PATTERN,
  type Branch,
  type Location,
  type LocationInput,
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
import { Segmented } from "@workspace/ui/components/segmented";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { Switch } from "@workspace/ui/components/switch";
import { Field } from "@/components/field";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { AddressSearchField } from "@/components/address/address-search-field";
import { fillAddress } from "@/components/address/fill-address";

const STATE_CODES = US_STATES.map(([code]) => code) as [string, ...string[]];

/**
 * A valid location as the dialog checks it inline, with the shared rule's words (ADR 0059, part 4a,
 * D15); messages say what to fix (design brief "Copy"). The floor area takes the API's answer at
 * scale ("18000.000"); the map position is kept as read, so an edit never drops it.
 */
export const LOCATION_FORM = z.object({
  name: z.string().trim().min(1, LOCATION_MESSAGES.name).max(LOCATION_NAME_MAX, LOCATION_MESSAGES.nameLength),
  kind: z.enum(["warehouse", "showroom"], LOCATION_MESSAGES.kind),
  branchId: z.string().min(1, LOCATION_MESSAGES.branch),
  address: z.object({
    street: z.string().trim().min(1, PROFILE_MESSAGES.street),
    city: z.string().trim().min(1, PROFILE_MESSAGES.city),
    state: z.enum(STATE_CODES, PROFILE_MESSAGES.state),
    zip: z.string().regex(ZIP_PATTERN, PROFILE_MESSAGES.zip),
    county: z.string().trim(),
    lat: z.number().optional(),
    lng: z.number().optional(),
  }),
  isDefault: z.boolean(),
  displaySamples: z
    .number(LOCATION_MESSAGES.samples)
    .int(LOCATION_MESSAGES.samples)
    .min(0, LOCATION_MESSAGES.samples)
    .max(DISPLAY_SAMPLES_MAX, LOCATION_MESSAGES.samples),
  floorAreaSqFt: z.string().refine((value) => value === "" || QUANTITY_TEXT.test(value), LOCATION_MESSAGES.floorArea),
});

/** What the dialog's form holds once checked. */
export type LocationForm = z.infer<typeof LOCATION_FORM>;

/**
 * What the dialog sends, and the shared rule's refusal of it, or null (ADR 0059, part 4a, D15): an
 * edit keeps the branch it was added to, whatever the form says; only a warehouse can be the
 * default and only a showroom counts samples; a blank floor area is left out. The rule runs before
 * anything is sent, so both modes refuse with the same words.
 */
export function locationSave(
  values: LocationForm,
  location: Location | null,
  locations: readonly Location[],
  branches: readonly Pick<Branch, "id">[],
  newId: string,
): { location: Location; problem: string | null } {
  const input: LocationInput = {
    name: values.name,
    kind: values.kind,
    branchId: location ? location.branchId : values.branchId,
    address: values.address,
    isDefault: values.kind === "warehouse" && values.isDefault,
    displaySamples: values.kind === "showroom" ? values.displaySamples : 0,
    ...(values.floorAreaSqFt === "" ? {} : { floorAreaSqFt: values.floorAreaSqFt }),
  };
  const others = locations.filter((other) => other.id !== location?.id);
  return {
    location: { id: location?.id ?? newId, ...input },
    problem: locationProblem(input, { before: location ?? undefined, others, branches }),
  };
}

const KINDS = [
  ["warehouse", "Warehouse"],
  ["showroom", "Showroom"],
] as const;

/**
 * Adds or edits a warehouse or showroom (spec A1; ADR 0059, part 4a): the shared rule runs before
 * anything is sent, the branch is read only on an edit, and inputs stop at the rule's and the API
 * body's lengths. `locations` are the company's live ones, for the name and default checks.
 */
export function LocationDialog({
  location,
  branches,
  locations,
  onClose,
}: {
  location: Location | null;
  branches: Branch[];
  locations: readonly Location[];
  onClose: () => void;
}) {
  const { company } = useWorkspace();
  const form = useForm<LocationForm>({
    resolver: zodResolver(LOCATION_FORM),
    defaultValues: location
      ? { ...location, floorAreaSqFt: location.floorAreaSqFt ?? "", address: { county: "", ...location.address } }
      : {
          name: "",
          kind: "warehouse",
          branchId: branches[0]?.id ?? "",
          address: { street: "", city: "", state: company.state, zip: "", county: "" },
          isDefault: false,
          displaySamples: 0,
          floorAreaSqFt: "",
        },
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  const { errors } = form.formState;

  async function save(values: LocationForm) {
    const newId = `${company.id}-loc-${crypto.randomUUID().slice(0, 8)}`;
    const { location: next, problem } = locationSave(values, location, locations, branches, newId);
    if (problem) {
      form.setError("root", { message: problem });
      return;
    }
    try {
      const saved = await api.saveLocation(next);
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
            <Input id="loc-name" maxLength={LOCATION_NAME_MAX} {...text("name")} />
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
                <Select value={field.value} onValueChange={field.onChange} disabled={location !== null}>
                  <SelectTrigger
                    id="loc-branch"
                    className="w-full"
                    ref={field.ref}
                    aria-describedby={location ? "loc-branch-hint" : undefined}
                  >
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
            {location ? (
              <p id="loc-branch-hint" className="text-muted-foreground text-xs">
                A location stays in the branch it was added to.
              </p>
            ) : null}
            {errorText("branchId", errors.branchId?.message)}
          </Field>
          <AddressSearchField
            id="loc-address-search"
            near={company.state}
            onSelect={(address) => fillAddress(form.setValue, address)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="loc-address.street" label="Street" className="sm:col-span-2">
              <Input id="loc-address.street" maxLength={ADDRESS_MAX.street} {...text("address.street")} />
              {errorText("address.street", errors.address?.street?.message)}
            </Field>
            <Field id="loc-address.city" label="City">
              <Input id="loc-address.city" maxLength={ADDRESS_MAX.city} {...text("address.city")} />
              {errorText("address.city", errors.address?.city?.message)}
            </Field>
            <Field id="loc-address.state" label="State">
              <Input id="loc-address.state" maxLength={2} {...text("address.state")} />
              {errorText("address.state", errors.address?.state?.message)}
            </Field>
            <Field id="loc-address.zip" label="ZIP">
              <Input id="loc-address.zip" inputMode="numeric" maxLength={ADDRESS_MAX.zip} {...text("address.zip")} />
              {errorText("address.zip", errors.address?.zip?.message)}
            </Field>
            <Field id="loc-address.county" label="County">
              <Input id="loc-address.county" maxLength={ADDRESS_MAX.county} {...text("address.county")} />
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
          <Field id="loc-area" label="Floor area, sq ft" hint="Used to share company-wide costs by floor area.">
            <Input
              id="loc-area"
              inputMode="decimal"
              maxLength={QUANTITY_TEXT_MAX}
              aria-describedby="loc-area-hint"
              {...form.register("floorAreaSqFt")}
            />
            {errorText("floorAreaSqFt", errors.floorAreaSqFt?.message)}
          </Field>
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
