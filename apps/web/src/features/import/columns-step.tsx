import type { ColumnMapping, ImportKindDef, ImportTable } from "@workspace/shared";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Label } from "@workspace/ui/components/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select";

/** The select value for "this file has no such column" (Radix selects take no empty value). */
const NONE = "__none";

/** The first filled value of a column, so people can see what they are matching. */
function sample(table: ImportTable, header: string | null): string {
  if (!header) return "";
  const at = table.headers.indexOf(header);
  return table.rows.find((r) => r[at]?.trim())?.[at] ?? "";
}

/**
 * Step 3 (spec G1): each field and the column of the file it reads, matched by header name
 * already and adjustable by dropdown, with the first value as a check. The mapping can be kept
 * for the next file of this kind.
 */
export function ColumnsStep({
  def,
  table,
  mapping,
  onChange,
  remember,
  onRemember,
  problems,
}: {
  def: ImportKindDef;
  table: ImportTable;
  mapping: ColumnMapping;
  onChange: (mapping: ColumnMapping) => void;
  remember: boolean;
  onRemember: (on: boolean) => void;
  problems: readonly string[];
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="border-hairline overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <caption className="sr-only">Which column of the file each field reads</caption>
          <thead className="bg-raised/60 text-muted-foreground text-left text-xs">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Field
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Column in your file
              </th>
              <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">
                First value
              </th>
            </tr>
          </thead>
          <tbody className="divide-hairline divide-y">
            {def.fields.map((field) => {
              const id = `map-${field.key}`;
              return (
                <tr key={field.key}>
                  <th scope="row" className="px-3 py-1.5 text-left font-normal">
                    <Label htmlFor={id} className="font-medium">
                      {field.label}
                    </Label>
                    {field.required ? <span className="text-muted-foreground block text-xs">Required</span> : null}
                  </th>
                  <td className="px-3 py-1.5">
                    <Select
                      value={mapping[field.key] ?? NONE}
                      onValueChange={(v) => onChange({ ...mapping, [field.key]: v === NONE ? null : v })}
                    >
                      <SelectTrigger id={id} className="w-full min-w-40 sm:w-56">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>Not in this file</SelectItem>
                        {table.headers.map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="text-muted-foreground hidden max-w-56 truncate px-3 py-1.5 sm:table-cell">
                    {sample(table, mapping[field.key] ?? null)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Checkbox checked={remember} onCheckedChange={(on) => onRemember(on === true)} />
        Remember these columns for the next {def.label.toLowerCase()} file
      </label>
      {problems.length ? (
        <ul className="text-danger-ink flex flex-col gap-1 text-sm">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
