"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, EyeOff, Filter, Minus, Plus } from "lucide-react";
import { isActive, NUMBER_KINDS, type ColumnFilter, type FilterKind, type NumberKind } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { useNumberSettings } from "@workspace/ui/components/number-settings";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/components/popover";
import { Separator } from "@workspace/ui/components/separator";
import { cn } from "@workspace/ui/lib/utils";
import { FilterEditor } from "./filter-editor";

interface ColumnMenuProps {
  id: string;
  label: string;
  sorted: false | "asc" | "desc";
  numeric: NumberKind | undefined;
  delta: number;
  /** Null when the column cannot be filtered. */
  filterKind: FilterKind | null;
  filter: ColumnFilter | undefined;
  options: string[];
  onSort: (desc: boolean) => void;
  onDelta: (delta: number) => void;
  onHide: () => void;
  onFilter: (filter: ColumnFilter) => void;
}

/**
 * A column header with its options (design brief "Tables", spec A2): sort, a filter that fits
 * the column, hide, and for numbers "More decimals / Fewer decimals" within the range the number
 * kind allows.
 */
export function ColumnMenu(props: ColumnMenuProps) {
  const { id, label, sorted, numeric, delta, filterKind, filter, options } = props;
  const settings = useNumberSettings();
  const SortIcon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
  const range = numeric ? NUMBER_KINDS[numeric] : undefined;
  const shown = numeric ? settings.decimals[numeric] + delta : 0;
  const filtered = !!filter && isActive(filter);
  const item = "h-8 w-full justify-start gap-2 px-2 font-normal";
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "hover:text-foreground -mx-1.5 inline-flex items-center gap-1 rounded-sm px-1.5 py-1",
          numeric && "flex-row-reverse",
          filtered && "text-brand-ink",
        )}
        aria-label={`${label}, column options${filtered ? ", filtered" : ""}`}
      >
        {label}
        {filtered ? <Filter aria-hidden="true" className="size-3.5" /> : null}
        <SortIcon aria-hidden="true" className={cn("size-3.5", !sorted && "opacity-40")} />
      </PopoverTrigger>
      <PopoverContent align={numeric ? "end" : "start"} className="bg-surface flex w-64 flex-col gap-1 p-2">
        <Button variant="ghost" size="sm" className={item} onClick={() => props.onSort(false)}>
          <ArrowUp />
          Sort ascending
        </Button>
        <Button variant="ghost" size="sm" className={item} onClick={() => props.onSort(true)}>
          <ArrowDown />
          Sort descending
        </Button>
        {filterKind ? (
          <>
            <Separator className="my-1" />
            <p className="text-muted-foreground px-2 text-xs font-medium">Filter</p>
            <div className="px-2 pb-1">
              <FilterEditor
                id={id}
                label={label}
                kind={filterKind}
                filter={filter}
                options={options}
                onChange={props.onFilter}
              />
            </div>
          </>
        ) : null}
        {range ? (
          <>
            <Separator className="my-1" />
            <Button
              variant="ghost"
              size="sm"
              className={item}
              disabled={shown >= range.max}
              onClick={() => props.onDelta(delta + 1)}
            >
              <Plus />
              More decimals
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={item}
              disabled={shown <= range.min}
              onClick={() => props.onDelta(delta - 1)}
            >
              <Minus />
              Fewer decimals
            </Button>
          </>
        ) : null}
        <Separator className="my-1" />
        <Button variant="ghost" size="sm" className={item} onClick={props.onHide}>
          <EyeOff />
          Hide column
        </Button>
      </PopoverContent>
    </Popover>
  );
}
