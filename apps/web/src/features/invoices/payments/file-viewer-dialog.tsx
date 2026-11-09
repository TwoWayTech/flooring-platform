"use client";

import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import type { FileMeta } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { api } from "@/lib/api";

/** Saves a blob under a file name through a temporary link. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Shows an attached file (spec Appendix A "attachment link opens a viewer; download allowed"):
 * images inline, PDFs in the browser's own viewer, HEIC as a download because browsers can't show it.
 */
export function FileViewerDialog({ file, onClose }: { file: FileMeta; onClose: () => void }) {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api
      .getFile(file.id)
      .then((b) => live && setBlob(b))
      .catch((e: unknown) => live && setFailed(e instanceof Error ? e.message : "The file could not be opened."));
    return () => {
      live = false;
    };
  }, [file.id]);
  const url = useMemo(() => (blob ? URL.createObjectURL(blob) : null), [blob]);
  useEffect(() => () => (url ? URL.revokeObjectURL(url) : undefined), [url]);

  const isImage = /^image\/(png|jpeg|webp)$/.test(file.type);
  const isPdf = file.type === "application/pdf";
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="bg-surface sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="truncate">{file.name}</DialogTitle>
          <DialogDescription>
            Added by {file.uploadedBy}, {file.uploadedAt.replace("T", " ")}
          </DialogDescription>
        </DialogHeader>
        {failed ? (
          <p className="text-danger-ink text-sm">{failed}</p>
        ) : !url ? (
          <Skeleton className="h-[60vh]" aria-label="Loading file" />
        ) : isImage ? (
          // eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable asset
          <img src={url} alt={file.name} className="max-h-[60vh] w-full object-contain" />
        ) : isPdf ? (
          <iframe src={url} title={file.name} className="border-hairline h-[60vh] w-full rounded border" />
        ) : (
          <p className="text-muted-foreground text-sm">
            This browser can&apos;t preview this file type. Download it to open it.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button disabled={!blob} onClick={() => blob && saveBlob(blob, file.name)}>
            <Download />
            Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
