import { importKind, type ImportKind } from "@workspace/shared";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { RadioGroup, RadioGroupItem } from "@workspace/ui/components/radio-group";

/**
 * Step 1 (spec G1): what to import, as one list. Each kind says what it brings in and what a
 * row matches on, so a second import updates instead of duplicating. With no kind open (an HR
 * Suite company on the API, whose kinds wait for part 2, or a role without the keys of any kind;
 * ADR 0057 S-1 to S-3), it says so instead of showing an empty list.
 */
export function KindStep({
  kinds,
  value,
  onChange,
}: {
  kinds: readonly ImportKind[];
  value: ImportKind | null;
  onChange: (kind: ImportKind) => void;
}) {
  if (kinds.length === 0) return <EmptyState message="Nothing can be imported here yet." />;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground max-w-prose text-sm">
        Bring records over in this order: suppliers before products, products before stock, and customers before their
        addresses and open invoices.
      </p>
      <RadioGroup
        value={value ?? ""}
        onValueChange={(v) => onChange(v as ImportKind)}
        aria-label="What to import"
        className="border-hairline divide-hairline gap-0 divide-y rounded-md border"
      >
        {kinds.map((kind) => {
          const def = importKind(kind);
          return (
            <label
              key={kind}
              className="has-[[data-state=checked]]:bg-brand-soft/50 flex cursor-pointer items-start gap-3 px-3 py-2.5"
            >
              <RadioGroupItem
                value={kind}
                className="mt-0.5"
                aria-labelledby={`kind-${kind}`}
                aria-describedby={`kind-${kind}-about`}
              />
              <span className="flex flex-col gap-0.5">
                <span id={`kind-${kind}`} className="text-sm font-medium">
                  {def.label}
                </span>
                <span id={`kind-${kind}-about`} className="text-muted-foreground text-xs">
                  {def.description} Rows match on {def.matchOn}.
                </span>
              </span>
            </label>
          );
        })}
      </RadioGroup>
    </div>
  );
}
