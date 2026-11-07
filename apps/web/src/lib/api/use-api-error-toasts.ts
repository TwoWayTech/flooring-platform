"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { ApiError } from "./errors";

/**
 * Shows any API error that a screen did not handle itself as a toast, for example a save made
 * while the presenter has the network offline, so a failed action never passes silently.
 */
export function useApiErrorToasts() {
  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (!(event.reason instanceof ApiError)) return;
      event.preventDefault();
      toast.error(event.reason.message);
    };
    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);
}
