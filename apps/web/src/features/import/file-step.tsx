"use client";

import { useState, type DragEvent } from "react";
import { FileSpreadsheet, LoaderCircle, Upload } from "lucide-react";
import { toast } from "sonner";
import { MAX_IMPORT_ROWS, templateTable, type ImportKindDef, type ImportTable } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { cn } from "@workspace/ui/lib/utils";
import { saveBlob } from "@/lib/save-blob";
import { parseImportFile, writeImportFile } from "./import-files";
import type { TableFormat } from "./worker-protocol";

/** A file read by the worker: its name, its table and, for a workbook, the sheet read. */
export interface LoadedFile {
  name: string;
  table: ImportTable;
  sheet: string | null;
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");

/**
 * Step 2 (spec G1): download a template in CSV or Excel, then upload the filled file. The file
 * is read in a Web Worker, so a large one does not freeze the page.
 */
export function FileStep({
  def,
  file,
  onFile,
}: {
  def: ImportKindDef;
  file: LoadedFile | null;
  onFile: (file: LoadedFile) => void;
}) {
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function read(chosen: File | undefined) {
    if (!chosen) return;
    setReading(true);
    setError(null);
    try {
      onFile({ name: chosen.name, ...(await parseImportFile(chosen)) });
    } catch (e) {
      setError(e instanceof Error ? e.message : "The file could not be read.");
    } finally {
      setReading(false);
    }
  }

  async function template(format: TableFormat) {
    try {
      const blob = await writeImportFile(templateTable(def), format, def.label);
      saveBlob(blob, `${slug(def.label)}-template.${format}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The template was not created.");
    }
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    void read(event.dataTransfer.files[0]);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground mr-1 text-sm">Start from the template:</span>
        <Button variant="outline" size="sm" onClick={() => void template("csv")}>
          <FileSpreadsheet />
          CSV template
        </Button>
        <Button variant="outline" size="sm" onClick={() => void template("xlsx")}>
          <FileSpreadsheet />
          Excel template
        </Button>
      </div>
      <label
        htmlFor="import-file"
        onDragOver={(e) => e.preventDefault()}
        onDrop={drop}
        className={cn(
          "border-hairline hover:bg-raised/60 focus-within:ring-ring flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed px-4 py-8 text-center focus-within:ring-2",
          reading && "pointer-events-none opacity-70",
        )}
      >
        {reading ? (
          <LoaderCircle
            aria-hidden="true"
            className="text-muted-foreground size-6 animate-spin motion-reduce:animate-none"
          />
        ) : (
          <Upload aria-hidden="true" className="text-muted-foreground size-6" />
        )}
        <span className="text-sm font-medium">{reading ? "Reading the file…" : "Choose a CSV or Excel file"}</span>
        <span className="text-muted-foreground text-xs">
          Or drop it here. Up to 10 MB and <Num value={MAX_IMPORT_ROWS} kind="count" /> rows; a workbook&apos;s first
          sheet is read.
        </span>
        <input
          id="import-file"
          type="file"
          accept=".csv,.txt,.xlsx,.xls,text/csv"
          className="sr-only"
          onChange={(e) => {
            void read(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </label>
      {error ? (
        <p role="alert" className="text-danger-ink text-sm">
          {error}
        </p>
      ) : null}
      {file && !reading ? (
        <p className="text-sm" aria-live="polite">
          <span className="font-medium">{file.name}</span>
          {file.sheet ? `, sheet ${file.sheet}` : ""}: <Num value={file.table.rows.length} kind="count" />{" "}
          {file.table.rows.length === 1 ? "row" : "rows"} and <Num value={file.table.headers.length} kind="count" />{" "}
          {file.table.headers.length === 1 ? "column" : "columns"}.
        </p>
      ) : null}
    </div>
  );
}
