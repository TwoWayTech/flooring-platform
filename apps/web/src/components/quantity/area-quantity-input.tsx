"use client";

import { useState } from "react";
import { editableDecimal, featureOn, parseAreaEntry, wholeCartonArea } from "@workspace/shared";
import { Input } from "@workspace/ui/components/input";

interface AreaQuantityInputProps {
  id?: string;
  "aria-label"?: string;
  /** Area in sq ft. */
  value: string;
  /** Coverage of one carton, when the product comes in cartons. */
  sqFtPerCarton?: string;
  onChange: (sqFt: string) => void;
  className?: string;
}

/**
 * A quantity field in sq ft that also takes cartons (spec A1): "500" is sq ft, "22c" or "22
 * cartons" converts when the field is left. Boxed goods round up to whole cartons (plan N-2),
 * so the figure on screen is what will be ordered or billed. A stored "19.800" shows as "19.8".
 */
export function AreaQuantityInput({ value, sqFtPerCarton, onChange, className, ...field }: AreaQuantityInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft === null) return;
    const pack = featureOn("units.square-feet") ? sqFtPerCarton : undefined;
    const parsed = parseAreaEntry(draft, pack);
    if (parsed) onChange((pack ? wholeCartonArea(parsed, pack) : parsed).toString());
    setDraft(null);
  }

  return (
    <Input
      {...field}
      value={draft ?? editableDecimal(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      className={className}
    />
  );
}
