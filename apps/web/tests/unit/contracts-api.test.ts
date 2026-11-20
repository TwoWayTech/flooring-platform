import { describe, expect, it } from "vitest";
import type { ContractInput } from "@/lib/api/contract";
import { fakeApi } from "./fake-api";

const CONTRACT = "0195f3a2-7b1c-7d4e-8f00-00000000c001";
const CUSTOMER = "0195f3a2-7b1c-7d4e-8f00-00000000c002";
const LOCATION = "0195f3a2-7b1c-7d4e-8f00-00000000c003";
const API_BRANCH = "0195f3a2-7b1c-7d4e-8f00-00000000c004";
const API_USER = "0195f3a2-7b1c-7d4e-8f00-00000000c005";

type DraftLine = ContractInput["lines"][number];

/** A line with its estimated cost, as a holder of view_sensitive sees it. */
const COSTED: DraftLine = {
  code: "L1",
  description: "Tile",
  category: "labor",
  billing: "milestone",
  scheduledValue: "1000.00",
  retainagePct: null,
  storedRetainagePct: null,
  milestoneDueAt: "2026-12-15",
  estimatedCost: "600.00",
};

/** A line whose estimated cost the API withheld (ADR 0044), so the key is absent. */
function uncosted(): DraftLine {
  const line: DraftLine = { ...COSTED, code: "L2", description: "Grout", scheduledValue: "250.50" };
  delete (line as Partial<DraftLine>).estimatedCost;
  return line;
}

/**
 * The whole form as api mode fills a new contract today: the branch and the rep are the shell
 * user's, which are still DemoStore's ids (ADR 0051 R1).
 */
function draft(over: Partial<ContractInput> = {}): ContractInput {
  return {
    direction: "customer",
    kind: "project",
    customerId: CUSTOMER,
    supplierId: null,
    title: "Lobby tile",
    scope: "Tile and grout",
    branchId: "sm-br-denver",
    locationId: LOCATION,
    jobSite: { street: "1 Main St", city: "Denver", state: "CO", zip: "80202" },
    salesRepId: "sm-usr-01",
    startsAt: "2026-11-17",
    endsAt: "2027-05-16",
    renewal: { mode: "none", noticeDays: 30 },
    retainagePct: "5",
    storedRetainagePct: "5",
    bondInLieu: false,
    taxTreatment: "on_billing",
    notes: "",
    lines: [COSTED, uncosted()],
    ...over,
  };
}

/** The body the API gets for `draft()`: the form's fields only, with no branch, rep or id. */
const SENT = {
  direction: "customer",
  kind: "project",
  customerId: CUSTOMER,
  supplierId: null,
  title: "Lobby tile",
  scope: "Tile and grout",
  locationId: LOCATION,
  jobSite: { street: "1 Main St", city: "Denver", state: "CO", zip: "80202" },
  startsAt: "2026-11-17",
  endsAt: "2027-05-16",
  renewal: { mode: "none", noticeDays: 30 },
  retainagePct: "5",
  storedRetainagePct: "5",
  bondInLieu: false,
  taxTreatment: "on_billing",
  notes: "",
  lines: [
    {
      code: "L1",
      description: "Tile",
      category: "labor",
      billing: "milestone",
      scheduledValue: "1000.00",
      retainagePct: null,
      storedRetainagePct: null,
      milestoneDueAt: "2026-12-15",
      estimatedCost: "600.00",
    },
    {
      code: "L2",
      description: "Grout",
      category: "labor",
      billing: "milestone",
      scheduledValue: "250.50",
      retainagePct: null,
      storedRetainagePct: null,
      milestoneDueAt: "2026-12-15",
    },
  ],
};

describe("saving a contract on the API: the server decides the branch and the rep (ADR 0044, B4)", () => {
  it("a new contract's body carries no branch or rep, so the API files it under its creator's (B4)", async () => {
    const { client, sent } = fakeApi({ "POST /contracts": { status: 201, body: { id: CONTRACT } } });
    await client.saveContract(draft());
    expect(sent[0]?.call).toBe("POST /contracts");
    expect(sent[0]?.body).not.toHaveProperty("branchId");
    expect(sent[0]?.body).toEqual(SENT);
  });

  it("an edit's body carries no branch or rep either", async () => {
    const { client, sent } = fakeApi({ [`PUT /contracts/${CONTRACT}`]: { status: 200, body: { id: CONTRACT } } });
    await client.saveContract(draft({ id: CONTRACT, branchId: API_BRANCH, salesRepId: API_USER }));
    expect(sent[0]?.call).toBe(`PUT /contracts/${CONTRACT}`);
    expect(sent[0]?.body).not.toHaveProperty("branchId");
    expect(sent[0]?.body).not.toHaveProperty("salesRepId");
    expect(sent[0]?.body).toEqual(SENT);
  });

  it("a branch that is a UUID is not sent either: the server stays the only judge", async () => {
    const { client, sent } = fakeApi({ "POST /contracts": { status: 201, body: { id: CONTRACT } } });
    await client.saveContract(draft({ branchId: API_BRANCH, salesRepId: API_USER }));
    expect(sent[0]?.call).toBe("POST /contracts");
    expect(sent[0]?.body).not.toHaveProperty("branchId");
    expect(sent[0]?.body).not.toHaveProperty("salesRepId");
  });
});
