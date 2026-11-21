"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

/**
 * Whether a page change should start at the top (click-through #20): yes for a new page reached by
 * a link, the sidebar or the palette; no for the first render, for back and forward (the browser
 * restores where the person was), and for a link to an anchor on the page.
 */
export function startsAtTop(change: { first: boolean; fromHistory: boolean; hash: string }): boolean {
  return !change.first && !change.fromHistory && change.hash === "";
}

/**
 * Scrolls the window to the top when the path changes. Next.js scrolls only when the new page is
 * out of view, so a page that renders a short loading state first kept the previous page's scroll
 * and opened at its bottom. Search-parameter changes (tabs, filters) keep the scroll.
 */
export function ScrollToTopOnNavigate() {
  const pathname = usePathname();
  const first = useRef(true);
  const fromHistory = useRef(false);

  useEffect(() => {
    const onPopState = () => {
      fromHistory.current = true;
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (startsAtTop({ first: first.current, fromHistory: fromHistory.current, hash: window.location.hash })) {
      window.scrollTo({ top: 0, left: 0 });
    }
    first.current = false;
    fromHistory.current = false;
  }, [pathname]);

  return null;
}
