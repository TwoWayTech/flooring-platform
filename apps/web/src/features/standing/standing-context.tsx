"use client";

import { createContext, useContext } from "react";
import type { CompanyStanding } from "@workspace/shared";

/** Where the open company stands, as the shell knows it (docs/specs/platform-admin.md, part 4). */
export interface StandingValue {
  /** The last answer of GET /company/standing, or null before the first one. */
  standing: CompanyStanding | null;
  /** True for maintenance, an unavailable database or a locked company: the overlay covers the page. */
  blocked: boolean;
  /** Reads standing again; resolves once the read and any trailing one are done. */
  recheck: () => Promise<void>;
}

/** Outside StandingGate the company counts as not blocked, so the shell works on its own. */
export const StandingContext = createContext<StandingValue>({
  standing: null,
  blocked: false,
  recheck: async () => undefined,
});

/** The open company's standing, from the nearest StandingGate. */
export function useStanding(): StandingValue {
  return useContext(StandingContext);
}
