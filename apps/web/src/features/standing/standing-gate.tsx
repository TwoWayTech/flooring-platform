"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CompanyStanding } from "@workspace/shared";
import { api } from "@/lib/api";
import { onStandingSignal } from "@/lib/api/standing-watch";
import { CompanyUnavailableOverlay } from "./company-unavailable";
import { StandingContext, type StandingValue } from "./standing-context";
import { createRecheck, overlayState } from "./standing-rules";

/**
 * Keeps the open company's standing for the shell (docs/specs/platform-admin.md, part 4, "While a
 * page is open"; ADR 0054). It starts from the server's answer, takes a new one after
 * `router.refresh()`, and reads again whenever a call is refused with a standing code (at most one
 * read in flight, plus one trailing). With no server answer, as in the demo, it reads once on mount.
 *
 * The overlay is a sibling of the children, with no wrapper around them, so the shell and the open
 * page keep their place in the tree and are never re-parented or remounted when it opens or closes.
 */
export function StandingGate({ initial, children }: { initial: CompanyStanding | null; children: ReactNode }) {
  const [standing, setStanding] = useState<CompanyStanding | null>(initial);
  // A router.refresh() renders the layout again with the server's new answer.
  const [serverAnswer, setServerAnswer] = useState(initial);
  if (initial !== serverAnswer) {
    setServerAnswer(initial);
    if (initial) setStanding(initial);
  }
  const [recheck] = useState(() => createRecheck(() => api.getCompanyStanding(), setStanding));
  const [startsUnknown] = useState(initial === null);

  useEffect(() => {
    if (startsUnknown) void recheck();
  }, [startsUnknown, recheck]);
  useEffect(() => onStandingSignal(() => void recheck()), [recheck]);

  const overlay = overlayState(standing);
  const blocked = overlay !== null;
  const value = useMemo<StandingValue>(() => ({ standing, blocked, recheck }), [standing, blocked, recheck]);
  return (
    <StandingContext.Provider value={value}>
      {children}
      <CompanyUnavailableOverlay state={overlay} onRetry={recheck} />
    </StandingContext.Provider>
  );
}
