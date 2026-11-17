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
