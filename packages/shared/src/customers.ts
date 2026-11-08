import type { Address, Customer, CustomerAddress, CustomerAddressLabel } from "./types";

/** Labels of customer addresses (spec A6). */
export const ADDRESS_LABELS: Record<CustomerAddressLabel, string> = {
  home: "Home",
  billing: "Billing",
  job_site: "Job site",
  delivery: "Delivery",
};

/**
 * A customer's address for a use: the one marked default for billing or job site, else the
 * first address, else none (a customer added quickly from a picker may have none yet).
 */
export function defaultAddress(
  customer: Pick<Customer, "addresses" | "defaultBillingId" | "defaultJobSiteId">,
  use: "billing" | "job_site",
): CustomerAddress | undefined {
  const id = use === "billing" ? customer.defaultBillingId : customer.defaultJobSiteId;
  return customer.addresses.find((a) => a.id === id) ?? customer.addresses[0];
}

/** An address without its label and id, as documents store a job site. */
export function plainAddress(address: CustomerAddress | Address | undefined): Address {
  if (!address) return { street: "", city: "", state: "", zip: "" };
  const { street, city, state, zip, county, lat, lng } = address;
  return { street, city, state, zip, ...(county ? { county } : {}), ...(lat !== undefined ? { lat, lng } : {}) };
}

/**
 * Whether a customer still needs their profile completed (spec A6): one added quickly from a
 * picker has a name but no address or no way to reach them yet. Derived, never stored.
 */
export function profileIncomplete(customer: Pick<Customer, "addresses" | "email" | "phone">): boolean {
  return customer.addresses.length === 0 || (!customer.email.trim() && !customer.phone.trim());
}

/** One line of an address for pickers and lists: "512 Oak St, Denver, CO 80202". */
export function addressLine(address: Address): string {
  return [
    address.street,
    [address.city, [address.state, address.zip].filter(Boolean).join(" ")].filter(Boolean).join(", "),
  ]
    .filter((part) => part.trim())
    .join(", ");
}
