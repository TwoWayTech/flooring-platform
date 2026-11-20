"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode, type Ref } from "react";
import { useRouter } from "next/navigation";
import { CloudOff, Lock, LogOut, RotateCw, Wrench, type LucideIcon } from "lucide-react";
import { STANDING_SCREENS, type BlockingStandingState } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@workspace/ui/components/dialog";
import { cn } from "@workspace/ui/lib/utils";
import { useSessionActions } from "@/lib/session/use-session-actions";

/**
 * The look of each blocked screen (spec part 4, "The standing screens"): warning tokens while the
 * company waits on us (maintenance, an unavailable database), danger tokens when it is suspended.
 * The icon is decoration: the title says the same in words.
 */
const SCREEN_LOOK: Readonly<Record<BlockingStandingState, { icon: LucideIcon; tone: string }>> = {
  maintenance: { icon: Wrench, tone: "text-warning-ink bg-warning/14" },
  unavailable: { icon: CloudOff, tone: "text-warning-ink bg-warning/14" },
  locked: { icon: Lock, tone: "text-danger-ink bg-danger/12" },
};

const TITLE_CLASS = "font-display text-xl leading-tight sm:text-2xl font-semibold tracking-[-0.01em] outline-none";
const BODY_CLASS = "text-muted-foreground max-w-prose text-sm leading-relaxed";

interface BlockedPanelProps {
  icon: LucideIcon;
  /** The icon chip's token classes: warning while the company waits on us, danger when it can't open. */
  tone: string;
  title: string;
  body: string;
  /** The page's h1 on a full page load, or the alert dialog's own title and description. */
  titleAs: "h1" | "dialog";
  onRetry: () => void;
  onSignOut: () => void;
  /** While a re-check runs, Try again waits. */
  pending: boolean;
  titleRef?: Ref<HTMLHeadingElement>;
  retryRef?: Ref<HTMLButtonElement>;
}

/**
 * One blocked screen's content: an icon, a title, the API's own words and the two ways on, Try
 * again and Sign out. The standing screens and the refused workspace (ADR 0051, "GET /company")
 * share it, so they look and behave alike.
 */
export function BlockedPanel({
  icon: Icon,
  tone,
  title,
  body,
  titleAs,
  onRetry,
  onSignOut,
  pending,
  titleRef,
  retryRef,
}: BlockedPanelProps) {
  return (
    <div className="flex flex-col items-start gap-5">
      <span className={cn("rounded-panel grid size-11 place-items-center", tone)}>
        <Icon aria-hidden="true" className="size-5" strokeWidth={2.25} />
      </span>
      <div className="flex flex-col gap-2">
        {titleAs === "dialog" ? (
          <>
            <DialogTitle ref={titleRef} className={TITLE_CLASS}>
              {title}
            </DialogTitle>
            <DialogDescription className={BODY_CLASS}>{body}</DialogDescription>
          </>
        ) : (
          <>
            <h1 ref={titleRef} tabIndex={-1} className={TITLE_CLASS}>
              {title}
            </h1>
            <p className={BODY_CLASS}>{body}</p>
          </>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button ref={retryRef} onClick={onRetry} disabled={pending}>
          <RotateCw aria-hidden="true" />
          Try again
        </Button>
        <Button variant="outline" onClick={onSignOut}>
          <LogOut aria-hidden="true" />
          Sign out
        </Button>
      </div>
    </div>
  );
}

/**
 * What a blocked company shows everyone, the Owner included (docs/specs/platform-admin.md, part 4,
 * "The standing screens"; owner question 21): the API's own words for the state, with no reason,
 * date or billing word, and the two ways on: Try again and Sign out.
 */
export function UnavailablePanel({
  state,
  ...panel
}: { state: BlockingStandingState } & Omit<BlockedPanelProps, "icon" | "tone" | "title" | "body">) {
  const { title, body } = STANDING_SCREENS[state];
  const { icon, tone } = SCREEN_LOOK[state];
  return <BlockedPanel icon={icon} tone={tone} title={title} body={body} {...panel} />;
}

/** The full-page frame of a blocked screen: a centred card in the page's own main landmark. */
export function FullPageCard({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="bg-background grid min-h-dvh place-items-center px-4 py-10">
      <div className="bg-surface border-hairline rounded-panel w-full max-w-md border p-6 sm:p-8">{children}</div>
    </main>
  );
}

/**
 * The blocked screen on a full page load (spec part 4, "Page mode"): the (app) layout renders it
 * instead of the shell, so no menu, workspace or page opens. Its title takes focus. Try again asks
 * the server again, which renders the shell once the company is usable.
 */
export function CompanyUnavailable({ state }: { state: BlockingStandingState }) {
  const router = useRouter();
  const { signOut } = useSessionActions();
  const [pending, startTransition] = useTransition();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus();
  }, []);
  return (
    <FullPageCard>
      <UnavailablePanel
        state={state}
        titleAs="h1"
        titleRef={title}
        pending={pending}
        onRetry={() => startTransition(() => router.refresh())}
        onSignOut={() => void signOut()}
      />
    </FullPageCard>
  );
}

/**
 * The blocked screen while a page is open (spec part 4, "While a page is open"; ADR 0054): an
 * alert dialog over the whole viewport, a sibling of the shell, so the open page is never
 * remounted. Escape and a click outside don't close it; Radix's modal layer traps focus, hides the
 * rest from assistive technology, stacks above any dialog already open and gives focus back when it
 * closes. Try again reads standing again; the dialog closes once the company is usable. Its only
 * motion is the dialog's fade, which the global reduced-motion rule turns off.
 */
export function CompanyUnavailableOverlay({
  state,
  onRetry,
}: {
  state: BlockingStandingState | null;
  onRetry: () => Promise<void>;
}) {
  const { signOut } = useSessionActions();
  const [pending, setPending] = useState(false);
  // The last blocking state, so the dialog keeps its words while it fades out.
  const [shown, setShown] = useState(state);
  if (state !== null && state !== shown) setShown(state);
  const retryButton = useRef<HTMLButtonElement>(null);

  const retry = () => {
    setPending(true);
    void onRetry().finally(() => setPending(false));
  };

  return (
    <Dialog open={state !== null} onOpenChange={() => undefined}>
      {shown ? (
        <DialogContent
          role="alertdialog"
          showCloseButton={false}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            retryButton.current?.focus();
          }}
          className="bg-background inset-0 top-0 left-0 grid h-dvh w-full max-w-none translate-x-0 translate-y-0 place-items-center overflow-y-auto rounded-none px-4 py-10 ring-0 sm:max-w-none"
        >
          <div className="bg-surface border-hairline rounded-panel w-full max-w-md border p-6 sm:p-8">
            <UnavailablePanel
              state={shown}
              titleAs="dialog"
              retryRef={retryButton}
              pending={pending}
              onRetry={retry}
              onSignOut={() => void signOut()}
            />
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
