import { dec } from "@workspace/shared";

/** One person's share of an invoice's commission, a percent as a decimal string. */
export interface CommissionShare {
  userId: string;
  pct: string;
}

/** The rep's share the dialog offers when the invoice isn't shared yet. */
const DEFAULT_REP_PCT = "60";

/**
 * The split the dialog sends (sales rule 39): the rep alone at 100, or the rep's share and the rest
 * to the second person. The rest is worked out with decimal.js, because a float sends 66.6's rest
 * as "33.400000000000006", which the API refuses (CLAUDE.md rule 6; whole-product check F-o).
 */
export function splitFor(repId: string, secondId: string | null, repPct: string): CommissionShare[] {
  if (!secondId) return [{ userId: repId, pct: "100" }];
  return [
    { userId: repId, pct: repPct },
    { userId: secondId, pct: dec(100).minus(repPct).toString() },
  ];
}

/**
 * What the dialog opens with: the second person and the rep's share, read by user rather than by
 * position, so a split saved with the other person first still shows the rep's own share.
 */
export function splitShown(
  split: readonly CommissionShare[] | undefined,
  repId: string,
): { second: string | null; pct: string } {
  const other = split?.find((share) => share.userId !== repId);
  const rep = split?.find((share) => share.userId === repId);
  if (!other) return { second: null, pct: DEFAULT_REP_PCT };
  return { second: other.userId, pct: rep?.pct ?? dec(100).minus(other.pct).toString() };
}
