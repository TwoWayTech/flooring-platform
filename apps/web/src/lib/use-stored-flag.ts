"use client";

import { useCallback, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
/** Holds a flag when the browser blocks storage, so it still works for this visit. */
const memory = new Map<string, boolean>();

function read(key: string): boolean {
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null) return stored === "1";
  } catch {
    // Storage is blocked; fall back to this visit's value.
  }
  return memory.get(key) ?? false;
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

/**
 * An on or off preference remembered in this browser, shared by every component that reads the
 * same key. The server and the first client render see `false`, so hydration always matches.
 */
export function useStoredFlag(key: string): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => false,
  );
  const set = useCallback(
    (on: boolean) => {
      memory.set(key, on);
      try {
        localStorage.setItem(key, on ? "1" : "0");
      } catch {
        // Kept in memory above.
      }
      listeners.forEach((notify) => notify());
    },
    [key],
  );
  return [value, set];
}
