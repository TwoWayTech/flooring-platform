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
import { StepUpDialog } from "@/components/step-up-dialog";
import { api } from "@/lib/api";

/** Asks before an Undo, since it removes what the import created; the step-up comes next. */
function UndoDialog({
  batch,
  onCancel,
  onConfirm,
}: {
  batch: ImportBatchSummary;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="bg-surface sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Undo {batch.number}?</DialogTitle>
          <DialogDescription>
            Records it created are removed, and records it updated go back to how they were before the import.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Undo import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Import history (spec G1 step 8): every import with what it did, and Undo for each one not
 * undone yet. The store refuses an Undo when the records changed or are used since. Undo asks
 * first, then for a step-up (ADR 0057 S-7), the role editor's pattern.
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
  // The batch whose Undo waits for the step-up; kept while the dialog closes, so its words stay.
  const [target, setTarget] = useState<ImportBatchSummary | null>(null);
  const [stepUp, setStepUp] = useState(false);

  /** The Undo itself, once the step-up passed. */
  async function undo() {
    if (!target) return;
    try {
      await api.undoImport(companyId, target.id);
      toast.success(`${target.number} undone`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The import was not undone.");
    } finally {
      setStepUp(false);
    }
  }

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
      {undoing ? (
        <UndoDialog
          batch={undoing}
          onCancel={() => setUndoing(null)}
          onConfirm={() => {
            setUndoing(null);
            setTarget(undoing);
            setStepUp(true);
          }}
        />
      ) : null}
      <StepUpDialog
        open={stepUp}
        action={target ? `Undoing ${target.number}` : "Undoing an import"}
        onOpenChange={setStepUp}
        onConfirm={undo}
      />
    </Panel>
  );
}
