"use client";

import { useEffect } from "react";

const EVENT = "fp:record-payment";

/** Asks the open invoice page to open Record payment (the command palette's action, spec Appendix A). */
export function requestRecordPayment() {
  window.dispatchEvent(new Event(EVENT));
}

/** Runs `onRequest` whenever Record payment is asked for from outside the page, such as the palette. */
export function useRecordPaymentRequest(onRequest: () => void) {
  useEffect(() => {
    window.addEventListener(EVENT, onRequest);
    return () => window.removeEventListener(EVENT, onRequest);
  }, [onRequest]);
}
