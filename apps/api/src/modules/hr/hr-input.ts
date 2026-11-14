import { NotFoundException } from "@nestjs/common";
import { featureOn, MAX_PROOF_FILES, type FeatureKey } from "@workspace/shared";
import { z } from "zod";

/** Hours as typed: up to two decimals, above or at zero (hr.md rule 5; numeric(14,3) holds them). */
export const HOURS = z
  .string()
  .trim()
  .regex(/^\d{1,6}(\.\d{1,2})?$/, "Enter hours such as 8 or 7.5.");

/** Hours that may take away from a balance: a sign, up to two decimals. */
export const SIGNED_HOURS = z
  .string()
  .trim()
  .regex(/^-?\d{1,6}(\.\d{1,2})?$/, "Enter the hours to add or take away.");

/** Money as typed: digits with at most two decimals, within numeric(14,2). */
export const MONEY = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount such as 22.50.");

/** Files in the body, base64, as proof files (ADR 0038); checked again after decoding. */
export const FILES = z
  .array(z.object({ name: z.string().max(200), data: z.string().max(7_000_000) }).strict())
  .max(MAX_PROOF_FILES, `Attach at most ${MAX_PROOF_FILES} files at a time.`);

/**
 * A route several screens read, open while any of their switches is on (CLAUDE.md rule 13): the
 * People list is read by People, Timesheets, Time off and Settings → HR. With all off it is 404.
 */
export function requireAnyFeature(...keys: [FeatureKey, ...FeatureKey[]]): void {
  if (!keys.some((key) => featureOn(key))) throw new NotFoundException();
}
