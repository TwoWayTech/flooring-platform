import type { ControlDb } from "@workspace/db";
import { tenantBranding } from "@workspace/db/control";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

/** A host name with an optional port, as the login page sends it (`summit.flooringsuite.com`). */
export const brandingQuerySchema = z.object({
  host: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(253)
    .regex(/^[a-z0-9.-]+(:\d{1,5})?$/),
});

/**
 * The branding the login page may show before anyone signs in. Only display fields: no ids,
 * timeouts or anything else from the company record (blueprint p16 "branding by host").
 */
export interface PublicBranding {
  displayName: string;
  monogram: string;
  brandColor: string;
  pattern: string;
  defaultTheme: "light" | "dark" | "system";
}

/** The company's public branding, or null when it has no branding row. */
export async function publicBrandingOf(db: ControlDb, companyId: string): Promise<PublicBranding | null> {
  const [row] = await db
    .select({
      displayName: tenantBranding.displayName,
      monogram: tenantBranding.monogram,
      brandColor: tenantBranding.brandColor,
      pattern: tenantBranding.pattern,
      defaultTheme: tenantBranding.defaultTheme,
    })
    .from(tenantBranding)
    .where(and(eq(tenantBranding.tenantId, companyId), isNull(tenantBranding.deletedAt)))
    .limit(1);
  return row ?? null;
}
