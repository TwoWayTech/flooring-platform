"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { History } from "lucide-react";
import { toast } from "sonner";
import {
  formatNumber,
  isPlatformAuditAction,
  PLATFORM_AUDIT_ACTIONS,
  type PlatformAuditQuery,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Label } from "@workspace/ui/components/label";
import { useNumberSettings } from "@workspace/ui/components/number-settings";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";
import { DataTable } from "@/components/data-table/data-table";
import { QueryFallback } from "@/components/query-fallback";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { useFormatDate } from "@/lib/use-format-date";
import { auditColumns, type AuditColumnFormat } from "./audit-columns";
import { AUDIT_ACTION_LABELS } from "./audit-labels";
import {
  appendOlderAuditPage,
  auditRows,
  olderAuditCursor,
  runOlderAuditLoad,
  type OlderAuditPages,
} from "./audit-paging";
import { usePlatformRole } from "./platform-role";

/** The Select value that stands for "no filter"; never a company id or an action. */
const ALL = "all";

/** The server-side filters: one company and one action, or every one. */
type AuditFilters = Pick<PlatformAuditQuery, "companyId" | "action">;

/** The one toast a failed older page shows, so a new load or new filters can take it away. */
const OLDER_FAILED_TOAST = "platform-audit-older-failed";

/** The console's formats for counts and moments in the audit log. */
function useAuditFormat(): AuditColumnFormat {
  const settings = useNumberSettings();
  const formatDate = useFormatDate();
  return useMemo(
    () => ({
      count: (value: number) => formatNumber(value, "count", settings),
      date: (iso: string) => formatDate(iso, true),
      dateTime: (iso: string) => formatDate(iso, true),
    }),
    [settings, formatDate],
  );
}

interface FilterSelectProps {
  id: string;
  label: string;
  value: string | undefined;
  allLabel: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string | undefined) => void;
}

/** A labelled filter with an "All …" choice first. */
function FilterSelect({ id, label, value, allLabel, options, onChange }: FilterSelectProps) {
  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-64">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value ?? ALL} onValueChange={(next) => onChange(next === ALL ? undefined : next)}>
        <SelectTrigger id={id} className="h-9 w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectItem value={ALL}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * The entries for one choice of filters: the newest page, then older pages on request, one load
 * at a time. It is keyed by the filters, so changing one starts again from the newest entries, and a
 * load still running for the old filters then changes nothing.
 */
function AuditEntries({ filters }: { filters: AuditFilters }) {
  const role = usePlatformRole();
  const format = useAuditFormat();
  const columns = useMemo(() => auditColumns(role, format), [role, format]);
  const first = useApiQuery((client) => client.listPlatformAudit(filters), [filters.companyId, filters.action]);
  const [older, setOlder] = useState<OlderAuditPages | null>(null);
  const [loading, setLoading] = useState(false);
  // The button and a failed load's Try again share this guard, so only one older page loads at a time.
  const inFlight = useRef(false);
  // False once these entries leave the screen, so a load still running then changes nothing.
  const live = useRef(true);
  // A Try again belongs to these filters: it goes when they change or the page closes.
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      toast.dismiss(OLDER_FAILED_TOAST);
    };
  }, []);

  if (first.status !== "ready") return <QueryFallback query={first} className="h-96" label="Loading audit log" />;
  const newest = first.data;
  const entries = auditRows(newest, older);
  const cursor = olderAuditCursor(newest, older);
  const filtered = filters.companyId !== undefined || filters.action !== undefined;

  async function loadOlder(before: string) {
    if (!live.current || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    toast.dismiss(OLDER_FAILED_TOAST);
    try {
      await runOlderAuditLoad({
        read: () => api.listPlatformAudit({ ...filters, before }),
        live: () => live.current,
        // An answer for a cursor another load already moved past is dropped, never added twice.
        add: (page) => setOlder((previous) => appendOlderAuditPage(newest, previous, before, page)),
        fail: (message) =>
          toast.error(message, {
            id: OLDER_FAILED_TOAST,
            action: { label: "Try again", onClick: () => void loadOlder(before) },
          }),
      });
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* No csvName, so no "Export CSV": reasons and user agents are free text (part 3, safer option 11). */}
      <DataTable
        id="platform-audit"
        rows={entries}
        columns={columns}
        getRowId={(entry) => entry.id}
        searchPlaceholder="Search the audit log"
        initialSort={{ id: "at", desc: true }}
        empty={{ message: filtered ? "No entries for these filters." : "No platform changes recorded yet." }}
      />
      {cursor ? (
        <Button variant="outline" className="self-start" onClick={() => void loadOlder(cursor)} disabled={loading}>
          <History />
          {loading ? "Loading older entries" : "Load older entries"}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Platform admin → Audit log (docs/specs/platform-admin.md, part 3, "Screens"; ADR 0053): every
 * entry of the platform audit log, newest first, filtered by company and by action on the server.
 * Entries arrive redacted by the shared rules, so the page shows no company data and no database
 * error text; the owner role also sees platform admins' address and device. There is no CSV export.
 */
export function PlatformAuditPage() {
  const [filters, setFilters] = useState<AuditFilters>({});
  const companies = useApiQuery((client) => client.listPlatformCompanies(), []);
  const companyOptions = useMemo(
    () =>
      companies.status === "ready"
        ? [...companies.data]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((company) => ({ value: company.id, label: company.name }))
        : [],
    [companies],
  );
  const actionOptions = PLATFORM_AUDIT_ACTIONS.map((action) => ({ value: action, label: AUDIT_ACTION_LABELS[action] }));

  return (
    <>
      <PageHeader
        title="Platform audit log"
        description="Every change made in the console, every support request and every failed database update, newest first. Company data and error text are never shown."
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <FilterSelect
          id="audit-company"
          label="Company"
          value={filters.companyId}
          allLabel="All companies"
          options={companyOptions}
          onChange={(companyId) => setFilters({ ...filters, companyId })}
        />
        <FilterSelect
          id="audit-action"
          label="Action"
          value={filters.action}
          allLabel="All actions"
          options={actionOptions}
          onChange={(action) =>
            setFilters({ ...filters, action: action && isPlatformAuditAction(action) ? action : undefined })
          }
        />
      </div>
      <AuditEntries key={`${filters.companyId ?? ALL}|${filters.action ?? ALL}`} filters={filters} />
    </>
  );
}
