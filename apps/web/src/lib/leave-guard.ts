import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

/**
 * The unsaved-changes guard (click-through #56): a page marks itself dirty while it holds changes
 * that are not saved, and `LeaveGuardDialog` then asks before a link, the command palette or the
 * browser takes the person away. One store for the app, so two dirty sections ask once.
 */
const dirty = new Set<symbol>();
const listeners = new Set<() => void>();
let pending: string | null = null;

function emit() {
  for (const listener of listeners) listener();
}

/** Subscribes to the guard's state (for `useSyncExternalStore`). */
export function subscribeLeaveGuard(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The guard's state: whether anything is unsaved, and where the person asked to go, if anywhere. */
export function leaveGuardState(): { dirty: boolean; pending: string | null } {
  return { dirty: dirty.size > 0, pending };
}

/** The state as one string, so `useSyncExternalStore` sees a stable value between changes. */
export function leaveGuardSnapshot(): string {
  return `${dirty.size > 0 ? 1 : 0}${pending ?? ""}`;
}

/** Asks before going to `href` (the dialog opens), or forgets the request with null. */
export function requestLeave(href: string | null): void {
  pending = href;
  emit();
}

/** Drops every unsaved mark, when the person chose to leave and lose them. */
export function discardUnsaved(): void {
  dirty.clear();
  pending = null;
  emit();
}

/** Marks the page as holding unsaved changes while `isDirty` is true. */
export function useUnsavedChanges(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return;
    const token = Symbol("unsaved");
    dirty.add(token);
    emit();
    return () => {
      dirty.delete(token);
      emit();
    };
  }, [isDirty]);
}

/** A router whose `push` asks first while something is unsaved, for in-app navigation from code. */
export function useGuardedRouter(): ReturnType<typeof useRouter> {
  const router = useRouter();
  return useMemo(
    () => ({ ...router, push: (href, options) => (dirty.size > 0 ? requestLeave(href) : router.push(href, options)) }),
    [router],
  );
}

/** What a click carries that decides whether it leaves the page. */
export interface LeaveClick {
  button: number;
  modifier: boolean;
  defaultPrevented: boolean;
  /** The link clicked, if any: its resolved address, its target and whether it downloads. */
  link: { href: string; target: string; download: boolean } | null;
}

/**
 * Where a click takes the person inside the app, or null when it doesn't leave this page: no link,
 * another button or a modifier (a new tab), a new window, a download, another site (the browser's
 * own prompt covers that) or this same page.
 */
export function leavingHref(
  click: LeaveClick,
  here: { origin: string; pathname: string; search: string },
): string | null {
  const { link } = click;
  if (!link || click.defaultPrevented || click.button !== 0 || click.modifier || link.download) return null;
  if (link.target && link.target !== "_self") return null;
  const url = new URL(link.href, here.origin);
  if (url.origin !== here.origin) return null;
  if (url.pathname === here.pathname && url.search === here.search) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
