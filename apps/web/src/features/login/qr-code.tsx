"use client";

import { useMemo } from "react";
import { qrDrawing } from "./qr-matrix";

interface QrCodeProps {
  /** What the code holds, such as an `otpauth://` link. It holds a secret, so it is never logged. */
  value: string;
  /** What a screen reader announces in place of the picture. */
  label: string;
}

/**
 * A QR code drawn locally as an SVG (ADR 0060): dark modules on a light tile in both themes, with
 * the quiet zone inside the tile, and crisp edges at any size.
 */
export function QrCode({ value, label }: QrCodeProps) {
  const drawing = useMemo(() => qrDrawing(value), [value]);
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid="qr-code"
      viewBox={`0 0 ${drawing.size} ${drawing.size}`}
      shapeRendering="crispEdges"
      className="bg-qr-paper fill-qr-ink border-hairline size-44 shrink-0 rounded-md border"
    >
      <path d={drawing.path} />
    </svg>
  );
}
