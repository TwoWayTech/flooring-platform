"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { featureOn } from "@workspace/shared";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useApiQuery } from "@/lib/api/use-api";
import { BillingNotice } from "./billing-notice";
import { useStanding } from "./standing-context";
import { bannerReread } from "./standing-rules";

/** The Billing page, which shows the same notice itself. */
const BILLING_PATH = "/settings/billing";

/**
 * The Owner's account banner in the shell (docs/specs/platform-admin.md, part 4, "The Owner's
 * banner"). It shows only while `settings.billing` is on, for the Owner (as View as shows them),
 * away from the Billing page, and while the company isn't blocked; anyone else reads nothing.
 */
export function OwnerBillingBanner() {
  const { access } = useWorkspace();
  const pathname = usePathname();
  const { blocked } = useStanding();
  if (!featureOn("settings.billing") || !access.isOwner || pathname === BILLING_PATH || blocked) return null;
  return <OwnerBillingNoticeQuery />;
}

/**
 * Reads the Owner's billing and shows its notice, if any. It reads again only when standing moves
 * into full use or read only from another known state (`bannerReread`, ADR 0054), never on a raw
 * refusal, and billing reads are not watched, so nothing can loop behind the overlay. While
 * loading, on any error or with no notice it shows nothing.
 */
function OwnerBillingNoticeQuery() {
  const { standing } = useStanding();
  const state = standing?.state ?? null;
  // The previous standing and how many transitions asked for a re-read, kept in step during render.
  const [seen, setSeen] = useState({ state, rereads: 0 });
  if (seen.state !== state) {
    setSeen({ state, rereads: seen.rereads + (bannerReread(seen.state, state) ? 1 : 0) });
  }
  const query = useApiQuery((client) => client.getCompanyBilling(), [seen.rereads]);
  if (query.status !== "ready" || !query.data.notice) return null;
  return <BillingNotice notice={query.data.notice} showLink />;
}
