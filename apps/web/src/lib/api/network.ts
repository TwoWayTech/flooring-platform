import { useSyncExternalStore } from "react";
import type { ApiClient } from "./contract";
import { ApiError } from "./errors";

/** How the simulated network behaves: as normal, slow (shows loading states) or offline (errors). */
export type NetworkMode = "normal" | "slow" | "offline";

/** The delay a slow network adds to every call, long enough to see the skeletons. */
export const SLOW_NETWORK_MS = 1500;
export const OFFLINE_MESSAGE = "The server did not answer. Check the connection, then try again.";

/**
 * ApiClient methods the simulation leaves alone: the ones that answer at once, and opening the
 * company, which is the session itself rather than a screen's read.
 */
const LOCAL_METHODS = new Set<PropertyKey>(["setViewer", "subscribe", "today", "openCompany"]);

let mode: NetworkMode = "normal";
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Switches the simulated network for this tab. Like a real connection it affects the next
 * request, so what is on screen stays. It lives in memory only: a reload brings back normal.
 */
export function setNetworkMode(next: NetworkMode) {
  mode = next;
  listeners.forEach((listener) => listener());
}

/** The simulated network mode, for controls that show or change it. */
export function useNetworkMode(): NetworkMode {
  return useSyncExternalStore(
    subscribe,
    () => mode,
    () => "normal",
  );
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wraps the ApiClient so presenters can show loading and error states (spec Tier 3). Offline
 * calls fail before they run, so nothing is saved; slow calls run after a delay.
 */
export function withSimulatedNetwork(client: ApiClient): ApiClient {
  return new Proxy(client, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      if (LOCAL_METHODS.has(key)) return value.bind(target);
      return async (...args: unknown[]) => {
        if (mode === "offline") throw new ApiError(OFFLINE_MESSAGE);
        if (mode === "slow") await wait(SLOW_NETWORK_MS);
        return value.apply(target, args);
      };
    },
  });
}
