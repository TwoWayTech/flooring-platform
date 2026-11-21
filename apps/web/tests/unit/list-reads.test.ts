import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LIST_READS, holdsAny, mayReadList, type ListReadPath, type PermissionKey } from "@workspace/shared";

/** The API's guard decisions per route, kept true by apps/api's route matrix (PM-1). */
const SNAPSHOT = fileURLToPath(new URL("../../../api/test/__snapshots__/route-requirements.json", import.meta.url));

interface RouteRequirement {
  anyOf: string[];
  anyMember: boolean;
}

const routes = (JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { routes: Record<string, RouteRequirement> }).routes;

describe("LIST_READS matches the API's route requirements (finding #28)", () => {
  it.each(Object.keys(LIST_READS) as ListReadPath[])("GET %s", (path) => {
    const route = routes[`GET ${path}`];
    expect(route, `GET ${path} is an API route`).toBeDefined();
    const keys: readonly string[] = LIST_READS[path];
    expect([...keys].sort()).toEqual([...route!.anyOf].sort());
    expect(route!.anyMember).toBe(keys.length === 0);
  });
});

describe("mayReadList", () => {
  const held = new Set<PermissionKey>(["sales.payment.approve"]);

  it("allows a read when any one of the route's keys is held, as PermissionGuard does", () => {
    expect(mayReadList("/payments", held)).toBe(true);
    expect(holdsAny(held, LIST_READS["/payments"])).toBe(true);
    expect(mayReadList("/suppliers", held)).toBe(false);
  });

  it("allows a read for every member with no permission at all", () => {
    expect(mayReadList("/locations", new Set())).toBe(true);
  });
});
