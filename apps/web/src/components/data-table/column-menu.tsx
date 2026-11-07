"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, EyeOff, Minus, Plus } from "lucide-react";
import { NUMBER_KINDS, type NumberKind } from "@workspace/shared";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { useNumberSettings } from "@workspace/ui/components/number-settings";
import { cn } from "@workspace/ui/lib/utils";

interface ColumnMenuProps {
  label: string;
  sorted: false | "asc" | "desc";
  numeric: NumberKind | undefined;
  delta: number;
  onSort: (desc: boolean) => void;
  onDelta: (delta: number) => void;
  onHide: () => void;
}

/**
 * A column header with its menu (design brief "Tables"): sort, hide, and for numbers "More
 * decimals / Fewer decimals" within the range the number kind allows.
 */
export function ColumnMenu({ label, sorted, numeric, delta, onSort, onDelta, onHide }: ColumnMenuProps) {
  const settings = useNumberSettings();
  const SortIcon = sorted === "asc" ? ArrowUp : sorted === "desc" ? ArrowDown : ArrowUpDown;
  const range = numeric ? NUMBER_KINDS[numeric] : undefined;
  const shown = numeric ? settings.decimals[numeric] + delta : 0;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "hover:text-foreground -mx-1.5 inline-flex items-center gap-1 rounded-sm px-1.5 py-1",
          numeric && "flex-row-reverse",
        )}
        aria-label={`${label}, column options`}
      >
        {label}
        <SortIcon aria-hidden="true" className={cn("size-3.5", !sorted && "opacity-40")} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align={numeric ? "end" : "start"} className="w-48">
        <DropdownMenuItem onSelect={() => onSort(false)}>
          <ArrowUp />
          Sort ascending
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSort(true)}>
          <ArrowDown />
          Sort descending
        </DropdownMenuItem>
        {range ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={shown >= range.max} onSelect={() => onDelta(delta + 1)}>
              <Plus />
              More decimals
            </DropdownMenuItem>
            <DropdownMenuItem disabled={shown <= range.min} onSelect={() => onDelta(delta - 1)}>
              <Minus />
              Fewer decimals
            </DropdownMenuItem>
          </>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onHide}>
          <EyeOff />
          Hide column
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
