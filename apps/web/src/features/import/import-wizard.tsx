"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  autoMap,
  importKind,
  mappingProblems,
  type ColumnMapping,
  type CompanyId,
  type ImportKind,
  type ImportRequest,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { api } from "@/lib/api";
import type { ImportOverview, ImportPreview, ImportResult } from "@/lib/api/contract";
import { CheckStep } from "./check-step";
import { ColumnsStep } from "./columns-step";
import { DoneStep } from "./done-step";
import { FileStep, type LoadedFile } from "./file-step";
import { ImportSteps, WIZARD_STEPS, type WizardStep } from "./import-steps";
import { KindStep } from "./kind-step";

/** The wizard's working state: the kind, the file read, the columns chosen and the dry run. */
interface Draft {
  kind: ImportKind | null;
  file: LoadedFile | null;
  mapping: ColumnMapping;
  preview: ImportPreview | null;
  result: ImportResult | null;
}

const EMPTY: Draft = { kind: null, file: null, mapping: {}, preview: null, result: null };

/**
 * The import wizard (spec G1): what to import, the file, its columns, the dry run, then the
 * import and its report. The store checks and plans every request again, so the screen never
 * decides what is written.
 */
export function ImportWizard({ companyId, overview }: { companyId: CompanyId; overview: ImportOverview }) {
  const [step, setStep] = useState<WizardStep>("kind");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [remember, setRemember] = useState(true);
  const [pending, setPending] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);
  const def = draft.kind ? importKind(draft.kind) : null;
  const problems = def ? mappingProblems(def, draft.mapping) : [];

  useEffect(() => {
    // Each step change puts focus on the step's title, so keyboard and screen reader users follow.
    if (moved.current) heading.current?.focus();
    moved.current = true;
  }, [step]);

  const request = (): ImportRequest => ({
    kind: draft.kind!,
    fileName: draft.file!.name,
    table: draft.file!.table,
    mapping: draft.mapping,
  });

  function chooseFile(file: LoadedFile) {
    const saved = overview.mappings.find((m) => m.kind === draft.kind)?.columns;
    setDraft({ ...draft, file, mapping: autoMap(def!, file.table.headers, saved), preview: null });
  }

  async function call<T>(work: () => Promise<T>, done: (value: T) => void) {
    setPending(true);
    try {
      done(await work());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work. Try again.");
    } finally {
      setPending(false);
    }
  }

  const check = () =>
    call(
      () => api.previewImport(companyId, request()),
      (preview) => {
        setDraft({ ...draft, preview });
        setStep("check");
      },
    );

  const run = () =>
    call(
      async () => {
        const result = await api.runImport(companyId, request());
        if (remember) await api.saveImportMapping(companyId, draft.kind!, draft.mapping);
        return result;
      },
      (result) => {
        setDraft({ ...draft, result });
        setStep("done");
        toast.success(`${result.batch.number} imported`);
      },
    );

  const toImport = draft.preview ? draft.preview.counts.create + draft.preview.counts.update : 0;
  const title = WIZARD_STEPS.find(([key]) => key === step)![1];

  return (
    <Panel title="Import a file" bodyClassName="flex flex-col gap-5">
      <ImportSteps current={step} />
      <h3 ref={heading} tabIndex={-1} className="font-semibold outline-none">
        {step === "kind" ? title : `${title}: ${def!.label.toLowerCase()}`}
      </h3>
      {step === "kind" ? (
        <KindStep kinds={overview.kinds} value={draft.kind} onChange={(kind) => setDraft({ ...EMPTY, kind })} />
      ) : null}
      {step === "file" && def ? <FileStep def={def} file={draft.file} onFile={chooseFile} /> : null}
      {step === "columns" && def && draft.file ? (
        <ColumnsStep
          def={def}
          table={draft.file.table}
          mapping={draft.mapping}
          onChange={(mapping) => setDraft({ ...draft, mapping, preview: null })}
          remember={remember}
          onRemember={setRemember}
          problems={problems}
        />
      ) : null}
      {step === "check" && def && draft.preview ? (
        <CheckStep def={def} preview={draft.preview} mapping={draft.mapping} />
      ) : null}
      {step === "done" && def && draft.result ? <DoneStep def={def} result={draft.result} /> : null}
      <div className="border-hairline flex flex-wrap justify-between gap-2 border-t pt-4">
        {step === "kind" || step === "done" ? (
          <span />
        ) : (
          <Button
            variant="outline"
            onClick={() => setStep(step === "file" ? "kind" : step === "columns" ? "file" : "columns")}
          >
            Back
          </Button>
        )}
        {step === "kind" ? (
          <Button disabled={!draft.kind} onClick={() => setStep("file")}>
            Next
          </Button>
        ) : null}
        {step === "file" ? (
          <Button disabled={!draft.file} onClick={() => setStep("columns")}>
            Next
          </Button>
        ) : null}
        {step === "columns" ? (
          <Button disabled={pending || problems.length > 0} onClick={() => void check()}>
            Check the file
          </Button>
        ) : null}
        {step === "check" ? (
          <Button disabled={pending || toImport === 0} onClick={() => void run()}>
            <span>
              Import <Num value={toImport} kind="count" /> {toImport === 1 ? "row" : "rows"}
            </span>
          </Button>
        ) : null}
        {step === "done" ? (
          <Button
            variant="outline"
            onClick={() => {
              setDraft({ ...EMPTY, kind: draft.kind });
              setStep("file");
            }}
          >
            Import another file
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}
