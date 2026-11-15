import { seesAuditNetwork, type PlatformAdminRole, type PlatformAuditView } from "@workspace/shared";
import type { ColumnSpec } from "@/components/data-table/types";
import { AuditDetails } from "./audit-details";
import { auditActionLabel, auditActorText, auditDetailsText, type AuditFormat } from "./audit-labels";

/** The console's formats for the audit log: counts and date-times. */
export interface AuditColumnFormat extends AuditFormat {
  /** The entry's moment, with its time. */
  dateTime: (iso: string) => string;
}

const NOT_RECORDED = "Not recorded";

/** An admin entry's address and device in one line, or "Not recorded". */
function networkText(entry: PlatformAuditView): string {
  const network = entry.network;
  if (!network || (!network.ip && !network.userAgent)) return NOT_RECORDED;
  return [network.ip, network.userAgent].filter(Boolean).join(" ");
}

/** The address on one line and the device under it, truncated with the full value on hover. */
function NetworkCell({ entry }: { entry: PlatformAuditView }) {
  const network = entry.network;
  if (!network || (!network.ip && !network.userAgent)) {
    return <span className="text-muted-foreground">{NOT_RECORDED}</span>;
  }
  return (
    <span className="flex max-w-60 flex-col">
      <span className="tabular-nums">{network.ip ?? "No address"}</span>
      <span className="text-muted-foreground truncate text-xs" title={network.userAgent ?? undefined}>
        {network.userAgent ?? "No device"}
      </span>
    </span>
  );
}

/**
 * The platform audit log's columns for this role (docs/specs/platform-admin.md, part 3, "Audit
 * log"): When, Who, Company, What and Details, and "Address and device" only for a role that sees
 * addresses (`seesAuditNetwork`). The API never sends addresses to any other role either; this only
 * keeps the screen from offering an empty column. Values are labels and redacted details only.
 */
export function auditColumns(role: PlatformAdminRole, format: AuditColumnFormat): ColumnSpec<PlatformAuditView>[] {
  const columns: ColumnSpec<PlatformAuditView>[] = [
    { id: "at", header: "When", value: (e) => e.at, cell: (e) => format.dateTime(e.at) },
    { id: "who", header: "Who", value: (e) => auditActorText(e.actor) },
    {
      id: "company",
      header: "Company",
      value: (e) => e.company?.name ?? "No company",
      cell: (e) => e.company?.name ?? <span className="text-muted-foreground">No company</span>,
    },
    {
      id: "what",
      header: "What",
      value: (e) => auditActionLabel(e.action),
      cell: (e) => <span className="font-medium">{auditActionLabel(e.action)}</span>,
    },
    {
      id: "details",
      header: "Details",
      value: (e) => auditDetailsText(e.details, format),
      cell: (e) => <AuditDetails details={e.details} format={format} />,
      filter: "text",
      className: "min-w-64 max-w-md whitespace-normal",
    },
  ];
  if (seesAuditNetwork(role)) {
    columns.push({
      id: "network",
      header: "Address and device",
      value: networkText,
      cell: (e) => <NetworkCell entry={e} />,
      filter: "text",
    });
  }
  return columns;
}
