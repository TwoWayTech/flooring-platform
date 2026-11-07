import type { ApiClient } from "./contract";
import { DemoStore } from "./demo/store";
import { withSimulatedNetwork } from "./network";

/**
 * The app's single ApiClient. NEXT_PUBLIC_DATA_SOURCE=demo (the default) selects DemoStore; a
 * real HTTP client would be chosen here when that variable says so (spec section 1).
 */
function createApiClient(): ApiClient {
  const source = process.env.NEXT_PUBLIC_DATA_SOURCE ?? "demo";
  if (source !== "demo") throw new Error(`Data source "${source}" is not available in the demo build.`);
  return new DemoStore();
}

/** The client every screen uses, behind the presenter's simulated network (normal by default). */
export const api: ApiClient = withSimulatedNetwork(createApiClient());
export type * from "./contract";
