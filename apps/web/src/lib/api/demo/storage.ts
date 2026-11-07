/**
 * localStorage access for the demo overlay. Storage can be missing or throw (private windows,
 * blocked site data), so every call is guarded and the demo keeps working from memory.
 */
const PREFIX = "fp-demo:v1:";

/** Reads and parses a stored value, or returns null. */
export function readStored<T>(key: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** Stores a value as JSON; ignores storage errors. */
export function writeStored(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Quota or privacy mode: the change still lives in memory for this session.
  }
}

/** Removes every demo key, for "Reset demo". */
export function clearStored(): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    for (const key of Object.keys(storage)) if (key.startsWith(PREFIX)) storage.removeItem(key);
  } catch {
    // Nothing stored to clear.
  }
}
