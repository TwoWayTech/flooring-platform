"use client";

import { useCallback, useEffect, useState, type DependencyList } from "react";
import { api } from ".";
import type { ApiClient } from "./contract";

type Result<T> =
  | { status: "loading"; data: undefined; error: undefined }
  | { status: "ready"; data: T; error: undefined }
  | { status: "error"; data: undefined; error: Error };

/** State of an API read: loading until the first result, then data or an error to retry. */
export type QueryState<T> = Result<T> & { retry: () => void };

const LOADING = { status: "loading", data: undefined, error: undefined } as const;

interface QueryOptions {
  /** Keep showing the last data when a later re-read fails, instead of switching to the error. */
  keepDataOnError?: boolean;
}

/**
 * Reads data through the ApiClient and re-reads whenever the data changes, so every screen
 * reflects an edit made anywhere else (for example a new brand color or a roll cut).
 */
export function useApiQuery<T>(
  read: (client: ApiClient) => Promise<T>,
  deps: DependencyList,
  { keepDataOnError = false }: QueryOptions = {},
): QueryState<T> {
  const [state, setState] = useState<Result<T>>(LOADING);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState(LOADING);
    setAttempt((n) => n + 1);
  }, []);
  useEffect(() => {
    let current = true;
    const run = () =>
      read(api).then(
        (data) => current && setState({ status: "ready", data, error: undefined }),
        (error: unknown) =>
          current &&
          setState((previous) =>
            keepDataOnError && previous.status === "ready"
              ? previous
              : { status: "error", data: undefined, error: error instanceof Error ? error : new Error(String(error)) },
          ),
      );
    void run();
    const unsubscribe = api.subscribe(() => void run());
    return () => {
      current = false;
      unsubscribe();
    };
    // `read` is recreated every render; callers list what it depends on in `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt]);
  return { ...state, retry };
}
