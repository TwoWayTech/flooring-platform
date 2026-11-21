"use client";

import { useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { FileText, ImageOff, Paperclip, X } from "lucide-react";
import { MAX_PROOF_FILES } from "@workspace/shared";
import { checkPickedProofFiles } from "./check-proof-files";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { cn } from "@workspace/ui/lib/utils";

/** What the picker accepts; the store checks the real type of each file again (spec Appendix A). */
const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp,image/heic,.heic,.pdf,.png,.jpg,.jpeg,.webp";

interface ProofFilesFieldProps {
  id: string;
  files: File[];
  onChange: (files: File[]) => void;
  /** Shown under the drop zone, e.g. why Save is disabled. */
  message?: string;
  error?: string;
  label?: string;
  /** What to drop here, e.g. "the supplier's invoice" (audit U-33). */
  dropHint?: string;
}

/** A preview for one chosen file: a thumbnail for images the browser can show, an icon otherwise. */
function Preview({ file }: { file: File }) {
  const previewable = /^image\/(png|jpeg|webp)$/.test(file.type);
  const url = useMemo(() => (previewable ? URL.createObjectURL(file) : null), [file, previewable]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable asset
    return <img src={url} alt="" className="border-hairline size-12 rounded border object-cover" />;
  }
  const Icon = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf") ? FileText : ImageOff;
  return (
    <span className="border-hairline bg-muted flex size-12 items-center justify-center rounded border">
      <Icon aria-hidden="true" className="text-muted-foreground size-5" />
    </span>
  );
}

/**
 * Proof of payment (spec Appendix A): drag and drop or the file picker, up to three files with a
 * thumbnail or a PDF icon, each removable before saving. HEIC shows an icon because browsers can't
 * preview it (plan K-8).
 */
export function ProofFilesField({
  id,
  files,
  onChange,
  message,
  error,
  label = "Proof of payment",
  dropHint = "the receipt, bank confirmation or check photo",
}: ProofFilesFieldProps) {
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  const [over, setOver] = useState(false);
  const [refused, setRefused] = useState<string[]>([]);
  const add = async (picked: FileList | readonly File[] | null) => {
    if (!picked) return;
    const checked = await checkPickedProofFiles(files.length, Array.from(picked));
    setRefused(checked.refused);
    if (checked.accepted.length > 0) onChange([...files, ...checked.accepted]);
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setOver(false);
    void add(event.dataTransfer.files);
  };
  const full = files.length >= MAX_PROOF_FILES;
  return (
    <fieldset className="flex flex-col gap-2" aria-describedby={hintId}>
      <legend className="mb-1.5 text-sm font-medium">{label}</legend>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={cn(
          "border-hairline flex flex-col items-center gap-2 rounded-md border border-dashed px-4 py-5 text-center text-sm",
          over && "border-brand bg-brand/5",
          error && "border-danger",
        )}
      >
        <Paperclip aria-hidden="true" className="text-muted-foreground size-5" />
        <p className="text-muted-foreground">Drop {dropHint} here, or</p>
        <Button
          id={id}
          type="button"
          variant="outline"
          size="sm"
          disabled={full}
          onClick={() => input.current?.click()}
          aria-describedby={hintId}
          aria-invalid={!!error}
        >
          Choose files
        </Button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(e) => {
            // Copy the list before clearing the input, which empties the live FileList.
            const picked = e.target.files ? Array.from(e.target.files) : [];
            e.target.value = "";
            void add(picked);
          }}
        />
      </div>
      <p id={hintId} className={cn("text-xs", error ? "text-danger-ink" : "text-muted-foreground")}>
        {error ?? message ?? `PDF, JPG, PNG, WebP or HEIC, up to 5 MB each, at most ${MAX_PROOF_FILES} files.`}
      </p>
      {refused.length > 0 ? (
        <ul role="alert" aria-label="Files not attached" className="text-danger-ink flex flex-col gap-1 text-xs">
          {refused.map((words) => (
            <li key={words}>{words}</li>
          ))}
        </ul>
      ) : null}
      {files.length > 0 ? (
        <ul className="flex flex-col gap-2" aria-label="Attached files">
          {files.map((file, i) => (
            <li key={`${file.name}-${i}`} className="flex items-center gap-3">
              <Preview file={file} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{file.name}</span>
                <span className="text-muted-foreground text-xs">
                  <Num kind="quantity" value={String(file.size / 1024)} unit="KB" />
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove ${file.name}`}
                onClick={() => onChange(files.filter((_, j) => j !== i))}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </fieldset>
  );
}
