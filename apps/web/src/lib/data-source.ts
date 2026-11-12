/** Where screens get their data: the in-browser DemoStore, or the real API module by module. */
export type DataSource = "demo" | "api";

/**
 * Reads NEXT_PUBLIC_DATA_SOURCE, inlined at build time (next.config.ts). `demo` (the default)
 * runs on DemoStore with the persona picker; `api` sends the methods in API_METHODS to apps/api.
 */
export function dataSource(): DataSource {
  const source = process.env.NEXT_PUBLIC_DATA_SOURCE ?? "demo";
  if (source !== "demo" && source !== "api") throw new Error(`Unknown data source "${source}".`);
  return source;
}

/** True in the demo build, where the persona picker, presenter tools and /api/demo/* exist. */
export function isDemoMode(): boolean {
  return dataSource() === "demo";
}
