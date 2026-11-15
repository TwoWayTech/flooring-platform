import type { PlatformAuditDetails } from "@workspace/shared";
import { auditDetailLines, type AuditFormat } from "./audit-labels";

/**
 * An audit entry's details in the platform audit log (docs/specs/platform-admin.md, part 3,
 * "Details"; part 2, "Screens", Audit log), one line per change, from the shared redacted view. A
 * hidden entry reads "Details hidden" and nothing more; a reason the viewer may not read reads
 * "Reason hidden", muted.
 */
export function AuditDetails({ details, format }: { details: PlatformAuditDetails; format: AuditFormat }) {
  const hidden = details.kind === "hidden";
  return (
    <span className="flex flex-col gap-0.5">
      {auditDetailLines(details, format).map((line, index) => (
        <span key={index} className={hidden || line.quiet ? "text-muted-foreground" : "break-words"}>
          {line.label ? <span className="text-muted-foreground">{line.label}: </span> : null}
          {line.text}
        </span>
      ))}
    </span>
  );
}
