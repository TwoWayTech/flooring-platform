import { ConflictException } from "@nestjs/common";
import type { ControlDb } from "@workspace/db";
import { tenantBranding } from "@workspace/db/control";
import type { Branding } from "@workspace/shared";
import { and, eq, isNull } from "drizzle-orm";

/**
 * The columns of the control `tenant_branding` row that Settings → Branding reads and writes (ADR
 * 0059, part 6, D2). The session timeouts and the logo, dark logo and favicon keys in the same row
 * are never read or written here.
 */
export const BRANDING_COLUMNS = {
  displayName: tenantBranding.displayName,
  monogram: tenantBranding.monogram,
  brandColor: tenantBranding.brandColor,
  pattern: tenantBranding.pattern,
  defaultTheme: tenantBranding.defaultTheme,
};

/** Branding's fields as the control row holds them. */
export type BrandingColumns = Omit<Branding, "logoDataUrl">;

/**
 * Branding as the API answers it: the row's fields, and no logo, so the monogram stands in (ADR
 * 0059, part 6, D5: the logo isn't on the API yet).
 */
export function brandingAnswer(row: BrandingColumns): Branding {
  return {
    displayName: row.displayName,
    monogram: row.monogram,
    brandColor: row.brandColor,
    pattern: row.pattern,
    logoDataUrl: null,
    defaultTheme: row.defaultTheme,
  };
}

/** The live branding row of one company: the tenant id is always the verified session's (TenantGuard's). */
export function brandingOf(companyId: string) {
  return and(eq(tenantBranding.tenantId, companyId), isNull(tenantBranding.deletedAt));
}

/** The company's branding as `GET /settings` answers it, or null when it has no live row (part 6, D6). */
export async function readBranding(control: ControlDb, companyId: string): Promise<Branding | null> {
  const [row] = await control.select(BRANDING_COLUMNS).from(tenantBranding).where(brandingOf(companyId)).limit(1);
  return row ? brandingAnswer(row) : null;
}

/**
 * The refusal of a branding save that waited too long for the control row's lock (part 6): another
 * save of the same company holds it. Nothing was written; trying again is safe.
 */
export function brandingBusy(): ConflictException {
  return new ConflictException({
    code: "branding_busy",
    message: "Branding is being saved by someone else right now. Try again in a moment.",
  });
}

/**
 * The refusal of a branding save for a company with no live branding row (part 6, D2). Provisioning
 * always writes one, so nothing is invented here: the session timeouts live in the same row.
 */
export function brandingMissing(): ConflictException {
  return new ConflictException({
    code: "branding_missing",
    message: "Branding isn't set up for this company yet. Ask us to set it up.",
  });
}
