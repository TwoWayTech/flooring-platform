import type { Address } from "@workspace/shared";

/** The address fields a form fills from a picked suggestion. */
const KEYS = ["street", "city", "state", "zip", "county"] as const;

/**
 * Copies a picked address into a React Hook Form form whose address lives under `address` (spec
 * A6), marking each field changed so the form's save bar and validation see it.
 */
export function fillAddress(
  setValue: (
    name: `address.${(typeof KEYS)[number]}`,
    value: string,
    options: { shouldDirty: boolean; shouldValidate: boolean },
  ) => void,
  address: Address,
) {
  for (const key of KEYS) setValue(`address.${key}`, address[key] ?? "", { shouldDirty: true, shouldValidate: true });
}
