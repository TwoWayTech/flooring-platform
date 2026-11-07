"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { X } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { cn } from "@workspace/ui/lib/utils";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { GUIDE_STEPS, type GuideStep } from "./guide-steps";
import { usePresenterGuide } from "./use-presenter-guide";

/** 2 when the browser shows the step's screen and tab, 1 for the screen alone, 0 otherwise. */
function matchScore(step: GuideStep, pathname: string, view: string | null): number {
  const [path, query = ""] = step.href.split("?");
  if (path !== pathname) return 0;
  const stepView = new URLSearchParams(query).get("view");
  if (!stepView) return 1;
  return stepView === view ? 2 : 0;
}

/** The step the presenter is on, or -1 when the current screen is not a step. */
function currentStep(steps: GuideStep[], pathname: string, view: string | null): number {
  const scores = steps.map((s) => matchScore(s, pathname, view));
  const best = Math.max(...scores);
  return best === 0 ? -1 : scores.indexOf(best);
}

/**
 * The presenter guide (spec Tier 3): a small floating panel listing the demo steps in order, each
 * linking to its screen. Steps the viewed role cannot open are greyed out, which itself shows
 * permissions at work during "View as".
 */
export function PresenterGuide() {
  const [open, setOpen] = usePresenterGuide();
  const { product, access } = useWorkspace();
  const pathname = usePathname();
  const view = useSearchParams().get("view");
  const steps = GUIDE_STEPS[product.key];
  const current = currentStep(steps, pathname, view);
  const explained = Math.max(current, 0);

  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          aria-labelledby="presenter-guide-title"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
          className="bg-surface border-hairline rounded-panel fixed inset-x-3 bottom-3 z-40 flex max-h-[45dvh] sm:max-h-[min(70dvh,560px)] flex-col border shadow-md sm:inset-x-auto sm:right-6 sm:bottom-6 sm:w-80 print:hidden"
        >
          <header className="border-hairline flex items-center gap-2 border-b py-2 pr-2 pl-4">
            <h2 id="presenter-guide-title" className="text-sm font-semibold">
              Demo steps
            </h2>
            <span className="text-muted-foreground text-xs tabular-nums">
              {current >= 0 ? `${current + 1} of ${steps.length}` : `${steps.length} steps`}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label="Close presenter guide"
              onClick={() => setOpen(false)}
            >
              <X />
            </Button>
          </header>
          <ol className="flex flex-col gap-0.5 overflow-y-auto p-2">
            {steps.map((step, i) => {
              const allowed = step.anyOf.some((p) => access.permissions.has(p));
              const here = i === current;
              const body = (
                <>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-px flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                      here ? "bg-brand text-brand-foreground" : "bg-raised text-muted-foreground",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className={cn("text-sm", here && "font-semibold")}>{step.title}</span>
                    {i === explained ? <span className="text-muted-foreground text-xs">{step.say}</span> : null}
                    {allowed ? null : <span className="text-muted-foreground text-xs">Not open to this role</span>}
                  </span>
                </>
              );
              const row = "flex items-start gap-2.5 rounded-md px-2 py-1.5";
              return (
                <li key={step.title}>
                  {allowed ? (
                    <Link
                      href={step.href}
                      aria-current={here ? "step" : undefined}
                      className={cn(row, here ? "bg-brand-soft/60" : "hover:bg-raised")}
                    >
                      {body}
                    </Link>
                  ) : (
                    <div className={cn(row, "opacity-60")}>{body}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}
