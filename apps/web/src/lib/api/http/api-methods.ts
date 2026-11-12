import type { HttpRoutes } from "./router";

/**
 * The ApiClient methods apps/api already serves when NEXT_PUBLIC_DATA_SOURCE=api. Empty until
 * the first module moves: each module's pull request adds its methods here, with the endpoints
 * from docs/api-contract.md, and its Playwright tests run against the API.
 */
export const API_METHODS: HttpRoutes = {};
