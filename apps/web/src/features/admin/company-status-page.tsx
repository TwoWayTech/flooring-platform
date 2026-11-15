"use client";

import { useEffect, useRef, useState, type Ref } from "react";
import { CircleAlert, Eye, RotateCw } from "lucide-react";
import {
  COMPANY_STATUS_ACTION_LABELS,
  mayManageBilling,
  statusActionText,
  type CompanyStatusActionView,
  type PlatformAdminRole,
  type PlatformCompany,
  type PlatformCompanyStatus,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { QueryFallback } from "@/components/query-fallback";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { BackToCompanies, CompanyAdminNav } from "./company-admin-nav";
import { CompanyFacts } from "./company-facts";
import { CompanyPhasePill, CompanyStatusPill } from "./company-status";
import { usePlatformRole } from "./platform-role";
import { StatusActionDialog } from "./status-action-dialog";

interface ActionRowProps {
  company: PlatformCompany;
  view: CompanyStatusActionView;
  writer: boolean;
  onAct: (view: CompanyStatusActionView) => void;
}

/**
 * One status action: its button (or, for a role that may not act, its name), and under it what
 * the action gives, or why it is refused. A refused action's button stays disabled with the
 * refusal in muted text, so no code is ever asked for it (criterion 91).
 */
function ActionRow({ company, view, writer, onAct }: ActionRowProps) {
  const formatDate = useFormatDate();
  const label = COMPANY_STATUS_ACTION_LABELS[view.action];
  const descriptionId = `status-${view.action}-text`;
  const description = view.next
    ? statusActionText(view.action, view.next, company.name, (iso) => formatDate(iso)).body
    : (view.refusal?.message ?? "");
  return (
    <li className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-6">
      <div className="sm:w-28 sm:shrink-0">
        {writer ? (
          <Button
            // The danger ink, not the button's own red, keeps Cancel at AA contrast on its tint in both themes.
            className={view.action === "cancel" ? "text-danger-ink w-full sm:w-28" : "w-full sm:w-28"}
            variant={view.action === "cancel" ? "destructive" : "outline"}
            disabled={view.next === null}
            onClick={() => onAct(view)}
            aria-describedby={descriptionId}
          >
            {label}
          </Button>
        ) : (
          <span className="text-sm font-medium">{label}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        {view.next ? (
          <p className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
            <span>After this:</span>
            <CompanyStatusPill status={view.next.status} />
            <CompanyPhasePill phase={view.next.phase} />
          </p>
        ) : null}
        <p id={descriptionId} className="text-muted-foreground max-w-prose text-sm">
          {description}
        </p>
      </div>
    </li>
  );
}

interface CompanyStatusViewProps {
  /** The company, or null when no company has that id. */
  company: PlatformCompany | null;
  /** The preview, or null when it can't be read although the company exists. */
  status: PlatformCompanyStatus | null;
  role: PlatformAdminRole;
  onAct: (view: CompanyStatusActionView) => void;
  onRetry: () => void;
  /** The panel's heading, which takes focus after a change because the button may be gone. */
  headingRef?: Ref<HTMLSpanElement>;
}

/**
 * Platform admin → Company → Status (docs/specs/platform-admin.md, part 2, "Screens"): the
 * company's facts, then the three actions in order, each with what it gives or why it is refused,
 * as the server's preview computed them. The support role reads the panel without buttons and a
 * note says why; the API's guard still decides. No company: "This company does not exist."; a
 * company whose preview reads null (a switch that differs between the web build and the API, or a
 * company deleted meanwhile) shows an error with Try again.
 */
export function CompanyStatusView({ company, status, role, onAct, onRetry, headingRef }: CompanyStatusViewProps) {
  const writer = mayManageBilling(role);
  if (!company) return <p className="text-muted-foreground">This company does not exist.</p>;
  return (
    <>
      <BackToCompanies />
      <PageHeader title={company.name} description="Status" />
      <CompanyAdminNav companyId={company.id} />
      {writer ? null : (
        <p
          role="note"
          className="border-hairline bg-raised text-muted-foreground flex items-start gap-2 rounded-md border px-3 py-2 text-sm"
        >
          <Eye aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          Read only: only the platform owner role can change a company&apos;s status.
        </p>
      )}
      <CompanyFacts company={company} />
      {status === null ? (
        <div
          role="alert"
          className="border-hairline flex flex-col items-start gap-3 rounded-md border border-dashed px-5 py-6"
        >
          <p className="flex items-start gap-2 font-medium">
            <CircleAlert aria-hidden="true" className="text-danger-ink mt-0.5 size-4 shrink-0" />
            The company&apos;s status can&apos;t be read right now.
          </p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RotateCw />
            Try again
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Panel
            title={
              <span ref={headingRef} tabIndex={-1} className="outline-none">
                Status
              </span>
            }
          >
            <ul className="divide-hairline divide-y">
              {status.actions.map((view) => (
                <ActionRow key={view.action} company={company} view={view} writer={writer} onAct={onAct} />
              ))}
            </ul>
          </Panel>
          <p className="text-muted-foreground max-w-prose text-sm">
            Subscriptions, payments and period corrections wait for the owner&apos;s billing decisions.
          </p>
        </div>
      )}
    </>
  );
}

/**
 * The Status page: reads the company and its status preview, then opens the status dialog for an
 * allowed action. After a change both are read again and focus moves to the panel's heading, since
 * the button may be gone; after a 409 or 422 they are read again too.
 */
export function CompanyStatusPage({ companyId }: { companyId: string }) {
  const role = usePlatformRole();
  const [reads, setReads] = useState(0);
  const [changes, setChanges] = useState(0);
  const [acting, setActing] = useState<CompanyStatusActionView | null>(null);
  const heading = useRef<HTMLSpanElement>(null);
  const data = useApiQuery(
    async (client) => {
      const company = await client.getPlatformCompany(companyId);
      return company ? { company, status: await client.getPlatformCompanyStatus(company.id) } : null;
    },
    [companyId, reads],
  );
  useEffect(() => {
    if (changes === 0) return;
    // After the dialog has closed and returned focus, which may be to a button now disabled.
    const timer = setTimeout(() => heading.current?.focus(), 250);
    return () => clearTimeout(timer);
  }, [changes]);

  if (data.status !== "ready") return <QueryFallback query={data} className="h-96" label="Loading company status" />;
  const company = data.data?.company ?? null;
  const status = data.data?.status ?? null;
  const reread = () => setReads((n) => n + 1);
  return (
    <>
      <CompanyStatusView
        company={company}
        status={status}
        role={role}
        onAct={setActing}
        onRetry={reread}
        headingRef={heading}
      />
      {company && status && acting?.next ? (
        <StatusActionDialog
          company={company}
          action={acting.action}
          next={acting.next}
          expectedStatus={status.status}
          onClose={() => setActing(null)}
          onChanged={() => {
            reread();
            setChanges((n) => n + 1);
          }}
          onRefused={reread}
        />
      ) : null}
    </>
  );
}
