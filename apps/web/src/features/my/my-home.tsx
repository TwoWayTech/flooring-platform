"use client";

import Link from "next/link";
import { Clock, LogIn, LogOut } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import type { MyPortal } from "@/lib/api/contract";
import { MyShell } from "./my-shell";

function Clocking({ portal }: { portal: MyPortal }) {
  const inAt = portal.clock.clockedInAt;
  async function run(action: () => Promise<void>, done: string) {
    try {
      await action();
      toast.success(done);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    }
  }
  return (
    <Panel title="Clock">
      <div className="flex flex-wrap items-center gap-3">
        <Clock aria-hidden="true" className="text-muted-foreground size-5" />
        <p className="text-sm">{inAt ? `Clocked in at ${inAt.slice(11, 16)}` : "You are not clocked in."}</p>
        {inAt ? (
          <Button
            onClick={() => void run(() => api.clockOut(), "Clocked out. Your hours are on this week's timesheet.")}
          >
            <LogOut />
            Clock out
          </Button>
        ) : (
          <Button onClick={() => void run(() => api.clockIn(), "Clocked in")}>
            <LogIn />
            Clock in
          </Button>
        )}
      </div>
    </Panel>
  );
}

function Card({ href, title, children }: { href: string; title: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="border-hairline bg-surface hover:bg-raised flex flex-col gap-1 rounded-lg border p-4">
      <span className="font-medium">{title}</span>
      <span className="text-muted-foreground text-sm">{children}</span>
    </Link>
  );
}

function Overview({ portal }: { portal: MyPortal }) {
  const { user } = useWorkspace();
  const thisWeek = portal.timesheets.find((s) => s.weekStart === portal.weekStart);
  const sentBack = portal.timesheets.find((s) => s.status === "rejected");
  const vacation = portal.balances.find((b) => b.policy.kind === "vacation");
  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground">
        Hello {user.name.split(" ")[0]}. Your hours, time off and pay are here, and only you and HR see them.
      </p>
      {portal.visible.clock ? <Clocking portal={portal} /> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {portal.usesTimesheet ? (
          <Card href="/my/timesheet" title="My timesheet">
            {sentBack
              ? "A timesheet was sent back. Please correct it."
              : thisWeek?.status === "submitted"
                ? "This week is submitted."
                : "Fill in and submit this week."}
          </Card>
        ) : null}
        {vacation ? (
          <Card href="/my/time-off" title="My time off">
            <Num kind="quantity" value={vacation.hours} unit="hours" /> of {vacation.policy.name.toLowerCase()} left.
          </Card>
        ) : null}
        {portal.visible.pay ? (
          <Card href="/my/pay" title="My pay">
            <Num kind="money" value={portal.earnedThisYear} /> estimated gross so far this year.
          </Card>
        ) : null}
        {portal.visible.commission ? (
          <Card href="/my/commission" title="My commission">
            Statements and what is waiting to be paid.
          </Card>
        ) : null}
        {portal.employee?.workerType === "1099" ? (
          <Card href="/my/payments" title="My payments">
            What has been approved and paid for your jobs.
          </Card>
        ) : null}
        {portal.employee ? (
          <Card href="/my/documents" title="My documents">
            {portal.employee.documents.length} on file.
          </Card>
        ) : null}
      </div>
    </div>
  );
}

/** The portal's first page (spec C2): the clock, and a card for each thing this person has. */
export function MyHome() {
  return <MyShell title="My portal">{(p) => <Overview portal={p} />}</MyShell>;
}
