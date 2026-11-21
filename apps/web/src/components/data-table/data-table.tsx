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
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { isActive, matchesFilter, sum, type ColumnFilter, type FilterKind } from "@workspace/shared";
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
import { useTimeZone } from "@/lib/use-format-date";
import { ColumnMenu } from "./column-menu";
import { downloadText, toCsv } from "./csv";
import { FilterChips } from "./filter-chips";
import { filterKindOf, optionsOf } from "./filter-kinds";
import type { ColumnSpec } from "./types";
import { useTablePrefs } from "./use-table-prefs";
import { useTableView } from "./use-table-view";

/** How long typing in the search waits before the address is updated. */
const SEARCH_DELAY_MS = 300;

interface DataTableProps<T> {
  /** Stable id; column preferences and the remembered view are kept under it. */
  id: string;
  rows: T[];
  columns: ColumnSpec<T>[];
  getRowId: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Accessible name of a clickable row, e.g. "Open roll NM-4471". */
  rowLabel?: (row: T) => string;
  searchPlaceholder?: string;
  /** Controls shown beside the search, such as a New button. */
  toolbar?: ReactNode;
  /** File name stem for CSV export; omit to hide the export. */
  csvName?: string;
  /** Actions for selected rows; providing it turns on bulk select. */
  bulkActions?: (selected: T[]) => ReactNode;
  empty: { message: string; action?: ReactNode };
  initialSort?: { id: string; desc: boolean };
}

/**
 * The table pattern from the design brief, the same everywhere (spec A2): global search, a
 * filter on every column, sort, show and hide columns, active filters as chips with Clear
 * filters, a result count, the view in the URL and remembered per person, CSV of the filtered
 * rows, and a totals row for money columns. Also row click, bulk select and More/Fewer decimals.
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
  const zone = useTimeZone();
  const [prefs, updatePrefs] = useTablePrefs(
    id,
    columns.filter((c) => c.hidden).map((c) => c.id),
  );
  const kinds = useMemo(() => {
    const out: Record<string, FilterKind> = {};
    for (const spec of columns) {
      const kind = filterKindOf(spec, rows);
      if (kind) out[spec.id] = kind;
    }
    return out;
  }, [columns, rows]);
  const [view, setView] = useTableView(id, kinds, initialSort ?? null);
  const [search, setSearch] = useState(view.search);
  const [selection, setSelection] = useState<RowSelectionState>({});
  const selectable = Boolean(bulkActions);
  const sortId = view.sort?.id;
  const sortDesc = view.sort?.desc;
  const sorting = useMemo<SortingState>(() => (sortId ? [{ id: sortId, desc: !!sortDesc }] : []), [sortId, sortDesc]);

  useEffect(() => setSearch(view.search), [view.search]);
  useEffect(() => {
    if (search === view.search) return;
    const timer = setTimeout(() => setView({ ...view, search }), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search, view, setView]);

  const filtered = useMemo(() => {
    const active = Object.entries(view.filters).filter(([, f]) => isActive(f));
    if (active.length === 0) return rows;
    return rows.filter((row) =>
      active.every(([columnId, filter]) => {
        const spec = columns.find((c) => c.id === columnId);
        return !spec || matchesFilter(spec.value(row), filter);
      }),
    );
  }, [rows, columns, view.filters]);
  const filtering = search.trim() !== "" || Object.values(view.filters).some(isActive);

  function setFilter(columnId: string, filter: ColumnFilter | null) {
    const filters = { ...view.filters };
    if (filter && isActive(filter)) filters[columnId] = filter;
    else delete filters[columnId];
    setView({ ...view, filters });
  }

  function clearAll() {
    setSearch("");
    setView({ ...view, search: "", filters: {} });
  }

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
    data: filtered,
    columns: defs,
    getRowId,
    state: {
      sorting,
      globalFilter: search,
      rowSelection: selection,
      columnVisibility: Object.fromEntries(prefs.hidden.map((c) => [c, false])),
    },
    onSortingChange: (change) => {
      const next = typeof change === "function" ? change(sorting) : change;
      setView({ ...view, sort: next[0] ?? null });
    },
    onGlobalFilterChange: setSearch,
    onRowSelectionChange: setSelection,
    enableRowSelection: selectable,
    // There is no pagination; without this, a re-render with new sort or filter objects resets a page index forever.
    autoResetAll: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const specOf = (columnId: string) => columns.find((c) => c.id === columnId);
  const visibleRows = table.getRowModel().rows;
  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  const showTotals = visibleRows.length > 0 && columns.some((c) => c.total && !prefs.hidden.includes(c.id));
  const totalOf = (spec: ColumnSpec<T>) =>
    sum(visibleRows.map((r) => spec.value(r.original)).filter((v): v is string | number => v !== null)).toString();

  function exportCsv() {
    const visible = columns.filter((c) => !prefs.hidden.includes(c.id));
    downloadText(
      `${csvName}-${api.today()}.csv`,
      toCsv(
        visibleRows.map((r) => r.original),
        visible,
        zone,
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
        <div className="ml-auto flex flex-wrap items-center gap-2">
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

      <FilterChips
        columns={columns}
        filters={view.filters}
        search={search}
        onRemove={(columnId) => setFilter(columnId, null)}
        onClearSearch={() => {
          setSearch("");
          setView({ ...view, search: "" });
        }}
        onClearAll={clearAll}
      />

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

      <div className="bg-surface border-hairline rounded-panel relative max-h-[calc(100dvh-13rem)] min-h-40 overflow-auto border">
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
                          id={`${id}-${spec.id}`}
                          label={spec.header}
                          sorted={header.column.getIsSorted()}
                          numeric={spec.kind}
                          delta={prefs.deltas[spec.id] ?? 0}
                          filterKind={kinds[spec.id] ?? null}
                          filter={view.filters[spec.id]}
                          options={kinds[spec.id] === "select" ? optionsOf(spec, rows) : []}
                          onSort={(desc) => setView({ ...view, sort: { id: spec.id, desc } })}
                          onDelta={(d) => updatePrefs((p) => ({ ...p, deltas: { ...p.deltas, [spec.id]: d } }))}
                          onHide={() => updatePrefs((p) => ({ ...p, hidden: [...p.hidden, spec.id] }))}
                          onFilter={(filter) => setFilter(spec.id, filter)}
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
          {showTotals ? (
            <tfoot className="bg-raised sticky bottom-0">
              <tr className="border-hairline border-t font-semibold">
                {table.getVisibleLeafColumns().map((column, index) => {
                  const spec = specOf(column.id);
                  return (
                    <td
                      key={column.id}
                      className={cn("h-9 px-3 whitespace-nowrap", spec?.kind && "text-right tabular-nums")}
                    >
                      {spec?.total && spec.kind ? (
                        <Num kind={spec.kind} value={totalOf(spec)} delta={prefs.deltas[spec.id] ?? 0} />
                      ) : index === 0 ? (
                        "Total"
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          ) : null}
        </table>
        {visibleRows.length === 0 ? (
          <EmptyState
            message={filtering ? "Nothing matches these filters." : empty.message}
            action={
              filtering ? (
                <Button variant="outline" onClick={clearAll}>
                  Clear filters
                </Button>
              ) : (
                empty.action
              )
            }
          />
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs" aria-live="polite">
        {visibleRows.length} of {rows.length}
      </p>
    </div>
  );
}
