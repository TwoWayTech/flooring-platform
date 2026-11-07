"use client";

import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { Columns3, Download, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { cn } from "@workspace/ui/lib/utils";
import { api } from "@/lib/api";
import { ColumnMenu } from "./column-menu";
import { downloadText, toCsv } from "./csv";
import type { ColumnSpec } from "./types";
import { useTablePrefs } from "./use-table-prefs";

interface DataTableProps<T> {
  /** Stable id; column preferences are remembered under it. */
  id: string;
  rows: T[];
  columns: ColumnSpec<T>[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Accessible name of a clickable row, e.g. "Open roll NM-4471". */
  rowLabel?: (row: T) => string;
  searchPlaceholder?: string;
  /** Filters shown beside the search. */
  toolbar?: ReactNode;
  /** File name stem for CSV export; omit to hide the export. */
  csvName?: string;
  /** Actions for selected rows; providing it turns on bulk select. */
  bulkActions?: (selected: T[]) => ReactNode;
  empty: { message: string; action?: ReactNode };
  initialSort?: { id: string; desc: boolean };
}

/**
 * The table pattern from the design brief: sticky header, column menu (sort, hide, more or
 * fewer decimals), row click, bulk select and CSV export. 36 px rows, numbers right-aligned.
 */
export function DataTable<T>({
  id,
  rows,
  columns,
  getRowId,
  onRowClick,
  rowLabel,
  searchPlaceholder = "Search",
  toolbar,
  csvName,
  bulkActions,
  empty,
  initialSort,
}: DataTableProps<T>) {
  const [prefs, updatePrefs] = useTablePrefs(
    id,
    columns.filter((c) => c.hidden).map((c) => c.id),
  );
  const [sorting, setSorting] = useState<SortingState>(initialSort ? [initialSort] : []);
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<RowSelectionState>({});
  const selectable = Boolean(bulkActions);

  const defs = useMemo<ColumnDef<T>[]>(() => {
    const data: ColumnDef<T>[] = columns.map((spec) => ({
      id: spec.id,
      accessorFn: (row) => spec.value(row),
      header: spec.header,
      enableGlobalFilter: !spec.visualOnly && !spec.kind,
      sortUndefined: "last",
      cell: ({ row, column }) => {
        const delta = prefs.deltas[column.id] ?? 0;
        if (spec.cell) return spec.cell(row.original, { delta });
        const value = spec.value(row.original);
        if (spec.kind && value !== null) return <Num kind={spec.kind} value={value} delta={delta} unit={spec.unit} />;
        return value;
      },
    }));
    if (!selectable) return data;
    const select: ColumnDef<T> = {
      id: "__select",
      header: ({ table }) => (
        <Checkbox
          aria-label="Select all rows"
          checked={table.getIsAllRowsSelected() || (table.getIsSomeRowsSelected() && "indeterminate")}
          onCheckedChange={(v) => table.toggleAllRowsSelected(v === true)}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          aria-label="Select row"
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(v === true)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
      enableSorting: false,
    };
    return [select, ...data];
  }, [columns, prefs.deltas, selectable]);

  // TanStack Table returns mutable objects the React Compiler cannot memoize; it skips this component.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: rows,
    columns: defs,
    getRowId,
    state: {
      sorting,
      globalFilter: search,
      rowSelection: selection,
      columnVisibility: Object.fromEntries(prefs.hidden.map((c) => [c, false])),
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    onRowSelectionChange: setSelection,
    enableRowSelection: selectable,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const specOf = (columnId: string) => columns.find((c) => c.id === columnId);
  const visibleRows = table.getRowModel().rows;
  const selected = table.getSelectedRowModel().rows.map((r) => r.original);

  function exportCsv() {
    const visible = columns.filter((c) => !prefs.hidden.includes(c.id));
    downloadText(
      `${csvName}-${api.today()}.csv`,
      toCsv(
        visibleRows.map((r) => r.original),
        visible,
      ),
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search
            aria-hidden="true"
            className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
          />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="bg-surface h-9 pl-8"
          />
        </div>
        {toolbar}
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-9">
                <Columns3 />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {columns.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c.id}
                  checked={!prefs.hidden.includes(c.id)}
                  onCheckedChange={(on) =>
                    updatePrefs((p) => ({
                      ...p,
                      hidden: on ? p.hidden.filter((h) => h !== c.id) : [...p.hidden, c.id],
                    }))
                  }
                  onSelect={(e) => e.preventDefault()}
                >
                  {c.header}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {csvName ? (
            <Button variant="outline" size="sm" className="h-9" onClick={exportCsv}>
              <Download />
              Export CSV
            </Button>
          ) : null}
        </div>
      </div>

      {selectable && selected.length > 0 ? (
        <div
          className="bg-brand-soft text-brand-ink flex flex-wrap items-center gap-3 rounded-md px-3 py-2 text-sm"
          role="status"
        >
          <span className="font-medium">{selected.length} selected</span>
          {bulkActions!(selected)}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelection({})}>
            Clear selection
          </Button>
        </div>
      ) : null}

      <div className="bg-surface border-hairline rounded-panel max-h-[calc(100dvh-13rem)] min-h-40 overflow-auto border">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-raised sticky top-0 z-10">
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const spec = specOf(header.column.id);
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className={cn(
                        "text-muted-foreground border-hairline h-9 border-b px-3 text-left text-xs font-medium whitespace-nowrap",
                        spec?.kind && "text-right",
                        header.column.id === "__select" && "w-10",
                      )}
                    >
                      {spec && !spec.visualOnly ? (
                        <ColumnMenu
                          label={spec.header}
                          sorted={header.column.getIsSorted()}
                          numeric={spec.kind}
                          delta={prefs.deltas[spec.id] ?? 0}
                          onSort={(desc) => setSorting([{ id: spec.id, desc }])}
                          onDelta={(d) => updatePrefs((p) => ({ ...p, deltas: { ...p.deltas, [spec.id]: d } }))}
                          onHide={() => updatePrefs((p) => ({ ...p, hidden: [...p.hidden, spec.id] }))}
                        />
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <tr
                key={row.id}
                tabIndex={onRowClick ? 0 : undefined}
                aria-label={onRowClick && rowLabel ? rowLabel(row.original) : undefined}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                onKeyDown={
                  onRowClick
                    ? (e) => {
                        if (e.key === "Enter") onRowClick(row.original);
                      }
                    : undefined
                }
                data-selected={row.getIsSelected() || undefined}
                className={cn(
                  "border-hairline h-9 border-b last:border-b-0",
                  onRowClick && "hover:bg-raised cursor-pointer",
                  "data-[selected]:bg-brand-soft",
                )}
              >
                {row.getVisibleCells().map((cell) => {
                  const spec = specOf(cell.column.id);
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        "px-3 py-1.5 whitespace-nowrap",
                        spec?.kind && "text-right tabular-nums",
                        spec?.className,
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        {visibleRows.length === 0 ? (
          <EmptyState
            message={search ? "Nothing matches your search." : empty.message}
            action={search ? undefined : empty.action}
          />
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs" aria-live="polite">
        {visibleRows.length} of {rows.length}
      </p>
    </div>
  );
}
