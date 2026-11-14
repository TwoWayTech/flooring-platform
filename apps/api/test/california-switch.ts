import { FEATURES } from "@workspace/shared";

/**
 * Runs `fn` with the California pay rules switched on (`hr.payroll.california`, off by default;
 * ADR 0050), then puts the switch back as it was. The API reads the same in-process register.
 * It can't leak into other files: apps/api/vitest.config.ts keeps Vitest's default isolation
 * (each test file gets its own module graph, so its own `FEATURES`), and tests inside a file run
 * one after another (none is `concurrent`). Never use it in a `concurrent` test.
 */
export async function withCaliforniaRules(fn: () => Promise<void>): Promise<void> {
  const feature = FEATURES["hr.payroll.california"] as { enabled: boolean };
  const before = feature.enabled;
  feature.enabled = true;
  try {
    await fn();
  } finally {
    feature.enabled = before;
  }
}
