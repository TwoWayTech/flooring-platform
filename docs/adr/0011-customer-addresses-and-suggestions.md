# ADR 0011: Many customer addresses, a quick-add customer picker, and address suggestions

Date: 2026-11-08. Status: accepted.

## Context
Feature batch 2, item A6: a call-centre customer picker (search by name, phone, email or company, with "Add as a new customer"), many labelled addresses per customer with defaults for billing and job site, and address suggestions while typing, with an offline demo provider and Google Places (New) when a key is set. A customer had one address.

## Decision
- `Customer.address` becomes `addresses: CustomerAddress[]` (label Home, Billing, Job site or Delivery) with `defaultBillingId` and `defaultJobSiteId`. `defaultAddress`, `plainAddress`, `addressLine` and `profileIncomplete` live in `packages/shared/src/customers.ts`. "New, profile incomplete" is derived (no address, or no phone and no email), never stored.
- `ApiClient.createCustomer` adds a customer at once with the company's default terms and no address (`customers.customer.create`); `saveCustomer` saves the profile and addresses (`customers.customer.edit`). Both are audited. The picker is used in the quote builder and the job card; the customer drawer completes the profile and manages addresses.
- Address suggestions sit behind `AddressProvider` (`lib/address/provider.ts`). The demo provider searches about 140 curated US cities (every state, denser where the demo companies sell, with county and approximate coordinates) and 300 seeded addresses, and builds addresses from a typed house number and street (plan K-12). The Google provider calls Places API (New) Autocomplete with a session token and one Place Details call with the field mask `formattedAddress,addressComponents,location`, US only; it is used only when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is set (plan A-2). Suggestions start at 3 characters after 250 ms. Picking one fills street, city, state, ZIP, county and coordinates; the fields always stay editable.
- The same search field is used for customer addresses, the company profile and warehouses; the supplier form adds it when it is built (D3). The switch `shell.addresses` hides it.
- Fixtures: each customer's address becomes its first address; contractors gain the job sites their quotes used and every third dealer a delivery address, without drawing new random numbers, so documents stay the same. Saved version 1 customers are upgraded the same way.

## Consequences
- The address suggestions are not app data, so they do not go through the ApiClient or the simulated network.
- README.demo.md explains how to create, restrict and set the Google key.
