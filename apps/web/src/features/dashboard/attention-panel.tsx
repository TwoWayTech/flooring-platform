"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Panel } from "@workspace/ui/components/panel";
import { cn } from "@workspace/ui/lib/utils";
import type { AttentionItem } from "@/lib/attention";
import { QueryFallback } from "@/components/query-fallback";
import { useAttention } from "@/components/shell/notifications";

const COUNT_TONE: Record<AttentionItem["tone"], string> = {
  danger: "text-danger-ink",
  warning: "text-warning-ink",
  brand: "text-brand-ink",
};

/** "Needs attention" (spec "Dashboard"): counts set like a ledger, each linking to where it is handled. */
export function AttentionPanel() {
  const attention = useAttention();
  return (
    <Panel title="Needs attention" bodyClassName="p-0">
      {attention.status !== "ready" ? (
        <QueryFallback query={attention} className="m-4 h-24" label="Loading what needs attention" />
      ) : attention.data.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6">Nothing needs your attention right now.</p>
      ) : (
        <ul className="divide-hairline divide-y">
          {attention.data.map((item) => (
            <li key={item.key}>
              <Link href={item.href} className="hover:bg-raised flex items-center gap-4 px-4 py-3">
                <span
                  className={cn(
                    "font-display w-10 text-right text-xl font-semibold tabular-nums",
                    COUNT_TONE[item.tone],
                  )}
                >
                  {item.count}
                </span>
                <span className="flex-1">{item.label}</span>
                <ChevronRight aria-hidden="true" className="text-muted-foreground size-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
