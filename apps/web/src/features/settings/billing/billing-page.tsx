"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Ban, CalendarClock, CircleHelp, Clock, CreditCard, type LucideIcon } from "lucide-react";
import {
  featureOn,
  PRODUCT_LABELS,
  SUBSCRIPTION_STANDING_TEXT,
  type CompanyBilling,
  type CompanyBillingSubscription,
  type SubscriptionStanding,
} from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { cn } from "@workspace/ui/lib/utils";
import { QueryFallback } from "@/components/query-fallback";
import { CompanyPhasePill, CompanyStatusPill } from "@/features/admin/company-status";
import { BillingNotice } from "@/features/standing/billing-notice";
import { useStanding } from "@/features/standing/standing-context";
import { HttpApiError } from "@/lib/api/http/transport";
import { STANDING_REFUSAL_CODES } from "@/lib/api/standing-watch";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";

/**
 * How each subscription standing reads under its plan: an icon with the words, never color alone.
 * Only a payment that is overdue draws the eye.
 */
const STANDING_LOOK: Readonly<Record<SubscriptionStanding, { icon: LucideIcon; tone: string }>> = {
  current: { icon: CalendarClock, tone: "text-muted-foreground" },
  past_due: { icon: CreditCard, tone: "text-warning-ink" },
  overdue: { icon: CreditCard, tone: "text-warning-ink" },
  trial: { icon: Clock, tone: "text-muted-foreground" },
  trial_ended: { icon: Clock, tone: "text-warning-ink" },
  cancelled: { icon: Ban, tone: "text-muted-foreground" },
  unknown: { icon: CircleHelp, tone: "text-muted-foreground" },
};

/** One plan the company holds: its name, product, billing interval, period and standing. */
function PlanBlock({ subscription }: { subscription: CompanyBillingSubscription }) {
  const formatDate = useFormatDate();
  const end = formatDate(subscription.currentPeriodEnd);
  const { icon: Icon, tone } = STANDING_LOOK[subscription.standing];
  return (
    <li className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-0.5">
        <h3 className="font-display text-lg leading-tight font-semibold tracking-[-0.01em]">{subscription.planName}</h3>
        <p className="text-muted-foreground text-sm">{PRODUCT_LABELS[subscription.product]}</p>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        <li>{subscription.interval === "yearly" ? "Billed yearly" : "Billed monthly"}</li>
        <li>
          Current period: {formatDate(subscription.currentPeriodStart)} to {end}
        </li>
        <li className={cn("inline-flex items-center gap-1.5 font-medium", tone)}>
          <Icon aria-hidden="true" className="size-4 shrink-0" />
          {SUBSCRIPTION_STANDING_TEXT[subscription.standing](end)}
        </li>
      </ul>
    </li>
  );
}

/** A plan limit as a count, or "No limit" when the plan sets none. */
function LimitValue({ value }: { value: number | null }) {
  if (value === null) return <span className="text-muted-foreground text-sm font-medium">No limit</span>;
  return <Num kind="count" value={value} className="font-display text-xl font-semibold" />;
}

/**
 * The Owner's read-only billing (docs/specs/platform-admin.md, part 4, "Billing"): the notice first,
 * then the account's status and access, its limits and its plans with their periods. No money is
 * shown anywhere: prices, invoices and payment details aren't part of the answer.
 */
export function BillingView({ billing }: { billing: CompanyBilling }) {
  const { userLimit, branchLimit } = billing.limits;
  return (
    <div className="flex flex-col gap-6">
      {billing.notice ? <BillingNotice notice={billing.notice} showLink={false} /> : null}
      <div className="grid gap-6 md:grid-cols-2">
        <Panel title="Account">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col items-start gap-1.5">
              <dt className="text-muted-foreground text-xs">Account status</dt>
              <dd>
                <CompanyStatusPill status={billing.status} />
              </dd>
            </div>
            <div className="flex flex-col items-start gap-1.5">
              <dt className="text-muted-foreground text-xs">Access</dt>
              <dd>
                <CompanyPhasePill phase={billing.phase} />
              </dd>
            </div>
          </dl>
        </Panel>
        <Panel title="Limits" bodyClassName="flex flex-col gap-4">
          <dl className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-xs">Users</dt>
              <dd>
                <LimitValue value={userLimit} />
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground text-xs">Branches</dt>
              <dd className="flex flex-col gap-0.5">
                <LimitValue value={branchLimit} />
                {branchLimit === null ? null : (
                  <span className="text-muted-foreground text-xs">Stored, not enforced yet.</span>
                )}
              </dd>
            </div>
          </dl>
          {featureOn("settings.users") ? (
            <Link
              href="/settings/users"
              className="text-brand-ink self-start text-sm font-medium underline-offset-2 hover:underline"
            >
              See seats in use
            </Link>
          ) : null}
        </Panel>
        <Panel title="Plan" className="md:col-span-2">
          {billing.subscriptions.length === 0 ? (
            <p className="text-sm">
              {billing.status === "trial"
                ? "No plan yet. Your trial includes every module of your products."
                : "No plan."}
            </p>
          ) : (
            <ul className="divide-hairline flex flex-col divide-y">
              {billing.subscriptions.map((subscription, at) => (
                <PlanBlock key={`${subscription.planName}-${at}`} subscription={subscription} />
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <p className="text-muted-foreground max-w-prose text-sm">
        This page is read only. To change your plan, renew or pay, contact us. Prices, invoices and payment details
        aren&apos;t shown here yet.
      </p>
    </div>
  );
}

/**
 * Settings → Billing, the Owner's only (spec part 4; ADR 0054). The page gate already keeps anyone
 * else out, and the API refuses them too. Billing reads aren't watched, so when this read is refused
 * with a standing code the page asks StandingGate to re-check itself, once per refusal; it never
 * reads billing again on a standing change, so nothing can loop.
 */
export function BillingPage() {
  const query = useApiQuery((client) => client.getCompanyBilling(), []);
  const { recheck } = useStanding();
  const failure = query.error;
  useEffect(() => {
    if (failure instanceof HttpApiError && STANDING_REFUSAL_CODES.has(failure.code)) void recheck();
  }, [failure, recheck]);
  if (query.status !== "ready") return <QueryFallback query={query} className="h-96" label="Loading billing" />;
  return <BillingView billing={query.data} />;
}
