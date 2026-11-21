"use client";

import {
  auditChanges,
  auditRecordLabel,
  formatNumber,
  type AuditEntry,
  type AuditValue,
  type NumberSettings,
} from "@workspace/shared";
import { Num } from "@workspace/ui/components/num";

/** One value as text, numbers in the company's format: for search and the CSV export. */
function valueText(value: AuditValue, settings: NumberSettings): string {
  switch (value.kind) {
    case "none":
      return "None";
    case "text":
      return value.text;
    case "number":
      return formatNumber(value.value, value.number, settings);
    case "record":
      return auditRecordLabel(value);
  }
}

/**
 * An entry's changes as text lines, "Label: old → new", for the table's search and CSV
 * (click-through #58). The screen shows the same lines through `AuditChangeList`.
 */
export function auditChangesText(entry: AuditEntry, settings: NumberSettings): string {
  return auditChanges(entry.before, entry.after, entry.names)
    .map((change) => {
      const after = change.after ? valueText(change.after, settings) : "None";
      const text = change.before ? `${valueText(change.before, settings)} → ${after}` : after;
      return change.key ? `${change.label}: ${text}` : text;
    })
    .join("; ");
}

/** One value on screen: numbers through <Num>, records by name. */
function Value({ value }: { value: AuditValue }) {
  switch (value.kind) {
    case "none":
      return <span className="text-muted-foreground">None</span>;
    case "text":
      return <span className="break-words">{value.text}</span>;
    case "number":
      return <Num value={value.value} kind={value.number} />;
    case "record":
      return <span className={value.name ? undefined : "text-muted-foreground"}>{auditRecordLabel(value)}</span>;
  }
}

/**
 * Settings → Audit log: what an entry changed, one line per field, "Label: old → new"
 * (click-through #58). Labels come from the field names, ids are named where the log found them,
 * and money and quantities use the company's number format. `raw` shows the stored before and
 * after as they are, for anyone who needs the exact values.
 */
export function AuditChangeList({ entry, raw }: { entry: AuditEntry; raw: boolean }) {
  if (raw) {
    return (
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 font-mono text-xs">
        <dt className="text-muted-foreground">Before</dt>
        <dd className="break-all">{entry.before ?? "None"}</dd>
        <dt className="text-muted-foreground">After</dt>
        <dd className="break-all">{entry.after ?? "None"}</dd>
      </dl>
    );
  }
  const changes = auditChanges(entry.before, entry.after, entry.names);
  if (changes.length === 0) return <span className="text-muted-foreground">No details</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {changes.map((change) => (
        <li key={change.key || "value"}>
          {change.key ? <span className="text-muted-foreground">{change.label}: </span> : null}
          {change.before ? (
            <>
              <Value value={change.before} />
              <span aria-label="changed to"> → </span>
            </>
          ) : null}
          {change.after ? <Value value={change.after} /> : <span className="text-muted-foreground">None</span>}
        </li>
      ))}
    </ul>
  );
}
