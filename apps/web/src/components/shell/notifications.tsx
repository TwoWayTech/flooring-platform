"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import { useApiQuery } from "@/lib/api/use-api";
import { loadAttention, type AttentionItem } from "@/lib/attention";
import { useWorkspace } from "@/components/workspace/workspace-context";

const DOT: Record<AttentionItem["tone"], string> = {
  danger: "bg-danger",
  warning: "bg-warning",
  brand: "bg-brand",
};

/** The viewer's attention items, re-read whenever data or access changes. */
export function useAttention() {
  const { access, session } = useWorkspace();
  return useApiQuery((client) => loadAttention(client, access, session.product), [access, session.product]);
}

/** The bell: what needs the viewer's attention, each item linking to where it is handled. */
export function Notifications() {
  const attention = useAttention();
  const items = attention.data ?? [];
  const total = items.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={total ? `Notifications, ${total} need attention` : "Notifications"}
          className="relative"
        >
          <Bell />
          {total ? (
            <span
              aria-hidden="true"
              className="bg-danger ring-background absolute top-1.5 right-1.5 size-2 rounded-full ring-2"
            />
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <p className="border-hairline border-b px-4 py-3 text-sm font-semibold">Needs attention</p>
        {items.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-sm">Nothing needs your attention right now.</p>
        ) : (
          <ul className="py-1">
            {items.map((item) => (
              <li key={item.key}>
                <Link href={item.href} className="hover:bg-raised flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOT[item.tone])} />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
