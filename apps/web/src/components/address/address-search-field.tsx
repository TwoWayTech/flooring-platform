"use client";

import { featureOn, type Address } from "@workspace/shared";
import { Field } from "@/components/field";
import { AddressAutocomplete } from "./address-autocomplete";

interface AddressSearchFieldProps {
  id: string;
  label?: string;
  near?: string;
  onSelect: (address: Address) => void;
}

/**
 * The "Find the address" field above address fields (spec A6), with its hint. Hidden while the
 * shell.addresses switch is off; the address fields below keep working by hand.
 */
export function AddressSearchField({ id, label = "Find the address", near, onSelect }: AddressSearchFieldProps) {
  if (!featureOn("shell.addresses")) return null;
  return (
    <Field id={id} label={label} hint="Pick a suggestion to fill the fields below, or enter the address manually.">
      <AddressAutocomplete id={id} near={near} describedBy={`${id}-hint`} onSelect={onSelect} />
    </Field>
  );
}
