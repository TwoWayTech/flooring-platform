import type { RecordStep } from "./overlay";

/**
 * Upgrade steps for saved records, one per model change of feature batch 2, run in order after
 * the role upgrade. Each step reads version 1 shapes and writes version 2 shapes.
 */
export const V2_RECORD_STEPS: RecordStep[] = [];
