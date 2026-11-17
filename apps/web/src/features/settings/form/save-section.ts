import { ApiError } from "@/lib/api/errors";

/** Where a settings save reports how it went: sonner's `toast`, or a stand-in in tests. */
export interface SaveNotifier {
  success(message: string): unknown;
  error(message: string): unknown;
}

/**
 * Saves one settings section and says how it went: a success toast, or the refusal's own words (an
 * ApiError, in both modes), or a plain "not saved" for anything else. Never throws, so a step-up
 * dialog that closes after the save can't swallow the message, and the caller keeps the draft when
 * it returns false (ADR 0059 D16).
 */
export async function saveSection<T>(
  value: T,
  onSave: (value: T) => Promise<void>,
  title: string,
  notify: SaveNotifier,
): Promise<boolean> {
  try {
    await onSave(value);
  } catch (error) {
    notify.error(error instanceof ApiError ? error.message : `${title} was not saved. Try again.`);
    return false;
  }
  notify.success(`${title} saved`);
  return true;
}

/** What pressing Save does next: stop (the draft was refused), ask for a step-up code, or save at once. */
export type SaveStep = "refused" | "step-up" | "save";

/**
 * What pressing Save on a settings section does first. The section's shared content rule
 * (packages/shared, the one the API and DemoStore run) goes before anything else: a refused draft
 * shows the rule's words and stops, so the step-up dialog never opens for it and a refused value
 * never spends an authenticator code (ADR 0059 D5, review round 1; the access editor does the same,
 * spec "One permission matrix"). Otherwise a step-up section asks for the code and any other saves.
 */
export function nextSaveStep<T>(
  draft: T,
  problem: ((draft: T) => string | null) | undefined,
  stepUp: boolean,
  notify: Pick<SaveNotifier, "error">,
): SaveStep {
  const reason = problem?.(draft) ?? null;
  if (reason !== null) {
    notify.error(reason);
    return "refused";
  }
  return stepUp ? "step-up" : "save";
}
