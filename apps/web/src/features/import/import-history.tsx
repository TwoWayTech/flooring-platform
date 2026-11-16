"use client";

import { useState } from "react";
import { Undo2 } from "lucide-react";
import { toast } from "sonner";
import { importKind, type CompanyId, type ImportBatchSummary } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { api } from "@/lib/api";

/** Asks before an Undo, since it removes what the import created. */
function UndoDialog({
  companyId,
  batch,
  onClose,
}: {
  companyId: CompanyId;
  batch: ImportBatchSummary;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  async function undo() {
    setPending(true);
    try {
      await api.undoImport(companyId, batch.id);
      toast.success(`${batch.number} undone`);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The import was not undone.");
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="bg-surface sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Undo {batch.number}?</DialogTitle>
          <DialogDescription>
            Records it created are removed, and records it updated go back to how they were before the import.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={() => void undo()}>
            Undo import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Import history (spec G1 step 8): every import with what it did, and Undo for each one not
 * undone yet. The store refuses an Undo when the records changed or are used since.
 */
export function ImportHistory({
  companyId,
  batches,
  formatDate,
}: {
  companyId: CompanyId;
  batches: readonly ImportBatchSummary[];
  formatDate: (iso: string, withTime?: boolean) => string;
}) {
  const [undoing, setUndoing] = useState<ImportBatchSummary | null>(null);
  return (
    <Panel title="Import history" bodyClassName="p-0">
      {batches.length === 0 ? (
        <EmptyState message="No imports yet. Each file you import shows here, with Undo." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">Imports, newest first</caption>
            <thead className="text-muted-foreground text-left text-xs">
              <tr className="border-hairline border-b">
                {["Import", "File", "When", "By", "Result"].map((h) => (
                  <th key={h} scope="col" className="px-4 py-2 font-medium whitespace-nowrap">
                    {h}
                  </th>
                ))}
                <th scope="col" className="px-4 py-2">
                  <span className="sr-only">Undo</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-hairline divide-y">
              {batches.map((b) => (
                <tr key={b.id}>
                  <th scope="row" className="px-4 py-2 text-left font-normal whitespace-nowrap">
                    <span className="block font-medium">{b.number}</span>
                    <span className="text-muted-foreground text-xs">{importKind(b.kind).label}</span>
                  </th>
                  <td className="max-w-40 truncate px-4 py-2">{b.fileName}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatDate(b.at, true)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{b.byName}</td>
                  <td className="min-w-40 px-4 py-2">
                    <Num value={b.counts.create} kind="count" /> created, <Num value={b.counts.update} kind="count" />{" "}
                    updated
                    {b.counts.error ? (
                      <>
                        , <Num value={b.counts.error} kind="count" /> with errors
                      </>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {b.undoneAt ? (
                      <StatusPill tone="neutral" icon={Undo2} label={`Undone ${formatDate(b.undoneAt)}`} />
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => setUndoing(b)} aria-label={`Undo ${b.number}`}>
                        <Undo2 />
                        Undo
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {undoing ? <UndoDialog companyId={companyId} batch={undoing} onClose={() => setUndoing(null)} /> : null}
    </Panel>
  );
}
