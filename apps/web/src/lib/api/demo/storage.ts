/**
 * localStorage access for the demo overlay. Storage can be missing or throw (private windows,
 * blocked site data), so every call is guarded and the demo keeps working from memory.
 * Version 2 data lives under its own prefix; version 1 data is read once to be upgraded.
 */
const PREFIX = "fp-demo:v2:";
const LEGACY_PREFIX = "fp-demo:v1:";

function read<T>(fullKey: string): T | null {
  try {
    const raw = globalThis.localStorage?.getItem(fullKey);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function removeWithPrefix(prefix: string): void {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return;
    for (const key of Object.keys(storage)) if (key.startsWith(prefix)) storage.removeItem(key);
  } catch {
    // Nothing stored to clear.
  }
}

/** Reads and parses a stored value, or returns null. */
export function readStored<T>(key: string): T | null {
  return read<T>(PREFIX + key);
}

/** Reads a value saved by the version 1 demo, or returns null. */
export function readLegacy<T>(key: string): T | null {
  return read<T>(LEGACY_PREFIX + key);
}

/** Removes one value saved by the version 1 demo, once it has been upgraded or dropped. */
export function removeLegacy(key: string): void {
  try {
    globalThis.localStorage?.removeItem(LEGACY_PREFIX + key);
  } catch {
    // Already gone.
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

/** Removes every demo key of both versions, for "Reset demo". */
export function clearStored(): void {
  removeWithPrefix(PREFIX);
  removeWithPrefix(LEGACY_PREFIX);
}
