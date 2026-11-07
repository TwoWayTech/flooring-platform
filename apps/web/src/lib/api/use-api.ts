"use client";

import { useEffect, useState, type DependencyList } from "react";
import { api } from ".";
import type { ApiClient } from "./contract";

/** State of an API read: loading until the first result, then data or an error. */
export type QueryState<T> =
  | { status: "loading"; data: undefined; error: undefined }
  | { status: "ready"; data: T; error: undefined }
  | { status: "error"; data: undefined; error: Error };

/**
 * Reads data through the ApiClient and re-reads whenever the data changes, so every screen
 * reflects an edit made anywhere else (for example a new brand color or a roll cut).
 */
export function useApiQuery<T>(read: (client: ApiClient) => Promise<T>, deps: DependencyList): QueryState<T> {
  const [state, setState] = useState<QueryState<T>>({ status: "loading", data: undefined, error: undefined });
  useEffect(() => {
    let current = true;
    const run = () =>
      read(api).then(
        (data) => current && setState({ status: "ready", data, error: undefined }),
        (error: unknown) =>
          current &&
          setState({
            status: "error",
            data: undefined,
            error: error instanceof Error ? error : new Error(String(error)),
          }),
      );
    void run();
    const unsubscribe = api.subscribe(() => void run());
    return () => {
      current = false;
      unsubscribe();
    };
    // `read` is recreated every render; callers list what it depends on in `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}
