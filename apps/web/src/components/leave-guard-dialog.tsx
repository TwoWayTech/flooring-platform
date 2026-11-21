"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  discardUnsaved,
  leaveGuardSnapshot,
  leaveGuardState,
  leavingHref,
  requestLeave,
  subscribeLeaveGuard,
} from "@/lib/leave-guard";

/** The link a click landed on, as `leavingHref` reads it. */
function linkOf(target: EventTarget | null) {
  const anchor = target instanceof Element ? target.closest("a[href]") : null;
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  return { href: anchor.href, target: anchor.target, download: anchor.hasAttribute("download") };
}

/**
 * Asks before leaving a page with unsaved changes (click-through #56): a link inside the app or a
 * guarded `push` opens this dialog, and closing or reloading the tab gets the browser's own prompt.
 * Rendered once in the app shell; pages mark themselves with `useUnsavedChanges`.
 */
export function LeaveGuardDialog() {
  const router = useRouter();
  useSyncExternalStore(subscribeLeaveGuard, leaveGuardSnapshot, () => "0");
  const { dirty, pending } = leaveGuardState();

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    const onClick = (event: MouseEvent) => {
      const click = {
        button: event.button,
        modifier: event.metaKey || event.ctrlKey || event.shiftKey || event.altKey,
        defaultPrevented: event.defaultPrevented,
        link: linkOf(event.target),
      };
      const href = leavingHref(click, window.location);
      if (!href) return;
      // Captured before Next's link handler, so the page stays until the person decides.
      event.preventDefault();
      event.stopPropagation();
      requestLeave(href);
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

  function leave() {
    const href = pending;
    discardUnsaved();
    if (href) router.push(href);
  }

  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && requestLeave(null)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave without saving?</DialogTitle>
          <DialogDescription>
            This page has changes that are not saved. Stay to save them, or leave and lose them.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={leave}>
            Leave and lose changes
          </Button>
          <Button autoFocus onClick={() => requestLeave(null)}>
            Stay on this page
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
