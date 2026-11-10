"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { featureOn } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { cn } from "@workspace/ui/lib/utils";
import { api } from "@/lib/api";
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

/** The bell (spec A4): the person's stored updates, then what needs attention, each linking to where it is handled. */
export function Notifications() {
  const attention = useAttention();
  const updates = useApiQuery((client) => client.listMyNotifications(), []);
  const items = attention.data ?? [];
  const mine = (updates.data ?? []).slice(0, 8);
  const unread = (updates.data ?? []).filter((n) => !n.readAt);
  const total = items.length + unread.length;
  const markRead = () => void api.markNotificationsRead(unread.map((n) => n.id));
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
      <PopoverContent align="end" className="max-h-[32rem] w-80 overflow-y-auto p-0">
        {featureOn("settings.notifications") && mine.length ? (
          <>
            <div className="border-hairline flex items-center justify-between border-b px-4 py-2">
              <p className="text-sm font-semibold">Updates</p>
              {unread.length ? (
                <Button variant="ghost" size="sm" onClick={markRead}>
                  Mark all read
                </Button>
              ) : null}
            </div>
            <ul className="py-1">
              {mine.map((n) => (
                <li key={n.id}>
                  <Link
                    href={n.href}
                    onClick={() => void api.markNotificationsRead([n.id])}
                    className={cn("hover:bg-raised block px-4 py-2 text-sm", n.readAt && "text-muted-foreground")}
                  >
                    {n.title}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <p className="border-hairline border-y px-4 py-3 text-sm font-semibold">Needs attention</p>
        {attention.status === "error" ? (
          <div className="flex flex-col items-start gap-2 px-4 py-6 text-sm">
            <p className="text-muted-foreground">Notifications could not load. {attention.error.message}</p>
            <Button variant="outline" size="sm" onClick={attention.retry}>
              Try again
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="text-muted-foreground px-4 py-6 text-sm">Nothing needs your attention right now.</p>
        ) : (
          <ul className="py-1">
            {items.map((item) => (
              <li key={item.key}>
                <Link href={item.href} className="hover:bg-raised flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span aria-hidden="true" className={cn("size-2 shrink-0 rounded-full", DOT[item.tone])} />
                  {item.count} {item.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {featureOn("settings.outbox") ? (
          <Link href="/outbox" className="border-hairline hover:bg-raised block border-t px-4 py-2.5 text-sm">
            See your Outbox
          </Link>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
