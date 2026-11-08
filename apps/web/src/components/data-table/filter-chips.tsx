"use client";

import { X } from "lucide-react";
import { BLANK_VALUE, isActive, type ColumnFilter } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Num } from "@workspace/ui/components/num";
import { useFormatDate } from "@/lib/use-format-date";
import type { ColumnSpec } from "./types";

/** What a filter keeps, in words and formatted numbers: "Overdue, Partly paid", "100 to 500". */
function FilterText<T>({ filter, column }: { filter: ColumnFilter; column: ColumnSpec<T> }) {
  const formatDate = useFormatDate();
  const num = (value: string) => <Num kind={column.kind ?? "quantity"} value={value} unit={column.unit} />;
  switch (filter.kind) {
    case "text":
      return <>contains “{filter.text.trim()}”</>;
    case "select":
      return <>{filter.values.map((v) => (v === BLANK_VALUE ? "(blank)" : v)).join(", ")}</>;
    case "range":
      if (filter.min && filter.max)
        return (
          <>
            {num(filter.min)} to {num(filter.max)}
          </>
        );
      return filter.min ? <>at least {num(filter.min)}</> : <>at most {num(filter.max)}</>;
    case "date":
      if (filter.from && filter.to) return <>{`${formatDate(filter.from)} to ${formatDate(filter.to)}`}</>;
      return <>{filter.from ? `from ${formatDate(filter.from)}` : `until ${formatDate(filter.to)}`}</>;
  }
}

interface FilterChipsProps<T> {
  columns: readonly ColumnSpec<T>[];
  filters: Record<string, ColumnFilter>;
  search: string;
  onRemove: (columnId: string) => void;
  onClearSearch: () => void;
  onClearAll: () => void;
}

/** Active filters as removable chips, with Clear filters (spec A2). Hidden when nothing is filtered. */
export function FilterChips<T>({ columns, filters, search, onRemove, onClearSearch, onClearAll }: FilterChipsProps<T>) {
  const active = columns.filter((c) => filters[c.id] && isActive(filters[c.id]!));
  if (active.length === 0 && !search.trim()) return null;
  return (
    <div className="flex flex-wrap items-center gap-2" aria-label="Active filters" role="group">
      {search.trim() ? (
        <Chip label={`Search: “${search.trim()}”`} onRemove={onClearSearch}>
          Search: “{search.trim()}”
        </Chip>
      ) : null}
      {active.map((column) => (
        <Chip key={column.id} label={`${column.header} filter`} onRemove={() => onRemove(column.id)}>
          <span className="font-medium">{column.header}:</span>{" "}
          <FilterText filter={filters[column.id]!} column={column} />
        </Chip>
      ))}
      <Button variant="ghost" size="sm" className="h-7" onClick={onClearAll}>
        Clear filters
      </Button>
    </div>
  );
}

function Chip({ label, onRemove, children }: { label: string; onRemove: () => void; children: React.ReactNode }) {
  return (
    <span className="bg-brand-soft text-brand-ink inline-flex h-7 items-center gap-1 rounded-full pr-1 pl-3 text-xs">
      <span>{children}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        className="hover:bg-surface/60 grid size-5 place-items-center rounded-full"
      >
        <X aria-hidden="true" className="size-3.5" />
      </button>
    </span>
  );
}
