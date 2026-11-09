"use client";

import type { InventorySettings } from "@workspace/shared";
import { Input } from "@workspace/ui/components/input";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { QueryFallback } from "@/components/query-fallback";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { SettingRow } from "../form/setting-row";
import { SettingsForm } from "../form/settings-form";

/** Stock rules on the warehouses page (spec C1): how large an adjustment may be before it needs approval. */
export function StockRulesForm() {
  const { settings } = useWorkspace();
  const defaults = useApiQuery((client) => client.getDefaultSettings(), []);
  if (defaults.status !== "ready")
    return <QueryFallback query={defaults} className="h-32" label="Loading stock rules" />;
  return (
    <SettingsForm
      title="Stock rules"
      description="Adjustments above this quantity wait for an Owner or Manager."
      initial={settings.inventory}
      defaults={defaults.data.inventory}
      onSave={(inventory: InventorySettings) => api.updateSettings("inventory", inventory).then(() => {})}
    >
      {(draft, setDraft, changed) => (
        <SettingRow setting="inventory.adjustmentApprovalQty" changed={changed("adjustmentApprovalQty")}>
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              aria-describedby={`${id}-hint`}
              value={draft.adjustmentApprovalQty}
              onChange={(e) => setDraft({ ...draft, adjustmentApprovalQty: e.target.value.replace(/[^\d.]/g, "") })}
              className="w-28 text-right tabular-nums"
            />
          )}
        </SettingRow>
      )}
    </SettingsForm>
  );
}
