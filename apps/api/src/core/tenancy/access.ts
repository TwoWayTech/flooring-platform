import { SetMetadata, type ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { ProductKey } from "@workspace/shared";

/**
 * What a route needs before it runs (CLAUDE.md rule 3, deny by default). Every route needs a
 * signed-in session with an open company unless it says otherwise:
 * - `public`: no session, for health, public branding and Better Auth's own endpoints;
 * - `session`: a session but no company, for /auth/context, which the chooser reads;
 * - `company` (the default): a session, an open company the person still belongs to, and the
 *   company checks in TenantGuard.
 */
export type AccessLevel = "public" | "session" | "company";

const ACCESS_KEY = "access:level";
const PRODUCT_KEY = "access:product";

/** Opens a route to anyone. Use only for routes that reveal nothing about a company's data. */
export const Public = () => SetMetadata(ACCESS_KEY, "public" satisfies AccessLevel);

/** Lets a signed-in session in before it has chosen a company. */
export const SessionOnly = () => SetMetadata(ACCESS_KEY, "session" satisfies AccessLevel);

/** Lets the route run only for a company that has this product (blueprint p17, products and hosts). */
export const RequireProduct = (product: ProductKey) => SetMetadata(PRODUCT_KEY, product);

/** The access level of the route a request is for; `company` when the route sets none. */
export function accessLevel(reflector: Reflector, context: ExecutionContext): AccessLevel {
  return reflector.getAllAndOverride<AccessLevel>(ACCESS_KEY, [context.getHandler(), context.getClass()]) ?? "company";
}

/** The product a route requires, if any. */
export function requiredProduct(reflector: Reflector, context: ExecutionContext): ProductKey | undefined {
  return reflector.getAllAndOverride<ProductKey>(PRODUCT_KEY, [context.getHandler(), context.getClass()]);
}
