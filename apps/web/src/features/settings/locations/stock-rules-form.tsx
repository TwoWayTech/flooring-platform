"use client";

import {
  inventorySettingsProblem,
  QUANTITY_TEXT_MAX,
  STOCK_RULES_OWNER_ONLY,
  stockRulesLoosened,
  type InventorySettings,
} from "@workspace/shared";
import { Input } from "@workspace/ui/components/input";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { QueryFallback } from "@/components/query-fallback";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { SettingRow } from "../form/setting-row";
import { SettingsForm } from "../form/settings-form";

/**
 * Stock rules on the warehouses page (spec C1): how large an adjustment may be before it needs
 * approval. Saved on the API in api mode (ADR 0059, the Stock rules part). Raising or clearing the
 * quantity loosens the two-person check, so it is the Owner's alone and asks for a step-up code; the
 * shared rule and the Owner-only words run first, so a refused value never costs a code (D4, D7).
 */
export function StockRulesForm() {
  const { settings, access } = useWorkspace();
  const defaults = useApiQuery((client) => client.getDefaultSettings(), []);
  const loosens = (draft: InventorySettings) => stockRulesLoosened(draft, settings.inventory);
  const problem = (draft: InventorySettings) =>
    inventorySettingsProblem(draft) ?? (!access.isOwner && loosens(draft) ? STOCK_RULES_OWNER_ONLY : null);
  if (defaults.status !== "ready")
    return <QueryFallback query={defaults} className="h-32" label="Loading stock rules" />;
  return (
    <SettingsForm
      title="Stock rules"
      description="Adjustments above this quantity wait for an Owner or Manager."
      initial={settings.inventory}
      defaults={defaults.data.inventory}
      problem={problem}
      stepUp={loosens}
      onSave={(inventory: InventorySettings) => api.updateSettings("inventory", inventory).then(() => {})}
    >
      {(draft, setDraft, changed) => (
        <SettingRow setting="inventory.adjustmentApprovalQty" changed={changed("adjustmentApprovalQty")}>
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              maxLength={QUANTITY_TEXT_MAX}
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
