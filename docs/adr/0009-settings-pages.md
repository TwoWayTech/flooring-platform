# ADR 0009: Settings pages that read the same way

Date: 2026-11-08. Status: accepted.

## Context
Feature batch 2, item A4: every settings page in both products gets a plain title and one sentence, toggles and controls with one helper line each, changed fields highlighted, a sticky Save / Discard bar, Reset to default per section, a search that finds any setting, and every change in the audit log. The settings home is grouped: Company; People and access; Sales and documents; Inventory and warehouses; Tax and localization; Payments; Commissions; Data import and integrations.

## Decision
- Each settings menu item carries its group and one sentence (`products/settings-menu.ts`). The settings layout's header shows the current page's label and sentence, so no page writes its own. `/settings` is a grouped home instead of a redirect; the sidebar's Settings link opens it. The HR Suite lists only Company, People and access, Tax and localization, and Data import.
- One toolkit in `features/settings/form`: `SettingsForm` (draft, Reset to default from `ApiClient.getDefaultSettings()`, optional step-up, sticky `SaveBar`), `SettingRow` (label, control, helper line, a tinted edge plus the word "Changed"), and `registry.ts`, which holds every setting's label, helper line and page. Rows read their text from the registry and the settings search searches it, so they cannot drift apart.
- Reset to default puts the original values in the draft; nothing changes until Save, which goes through `updateSettings` and the audit log.
- Documents moved from a tab of Localization and tax to its own page, Sales and documents (`/settings/documents`), where later items add waste and quote settings.

## Consequences
- Save buttons keep their names ("Save sales tax", "Save branding"), now in the bar, which appears only with unsaved changes.
- Later settings (tax defaults, payments, commissions, data import) add registry entries and use the same toolkit.
- The number-format e2e test now finds the Total column by its header instead of its position, because A1 added a Warehouse column.
