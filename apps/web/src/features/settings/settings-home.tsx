"use client";

import Link from "next/link";
import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@workspace/ui/components/input";
import { Panel } from "@workspace/ui/components/panel";
import { NoAccess } from "@/components/no-access";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { visibleItems } from "@/products";
import { SETTINGS_GROUPS, type SettingsGroup } from "@/products/settings-menu";
import { searchSettings, settingControlId } from "./form/registry";

/** The settings pages the viewer may open, by group, in the order of SETTINGS_GROUPS. */
function useGroups() {
  const { product, access } = useWorkspace();
  const items = visibleItems(product.settings, access);
  return (Object.keys(SETTINGS_GROUPS) as SettingsGroup[])
    .map((group) => ({ group, label: SETTINGS_GROUPS[group], items: items.filter((i) => i.group === group) }))
    .filter((g) => g.items.length > 0);
}

/**
 * "/settings" (spec A4): the settings pages grouped as Company, People and access, Sales and
 * documents and so on, each with one sentence, and a search box that finds any single setting.
 */
export function SettingsHome() {
  const groups = useGroups();
  const [query, setQuery] = useState("");
  const allowed = new Set(groups.flatMap((g) => g.items.map((i) => i.href)));
  const results = searchSettings(query).filter((r) => allowed.has(r.info.href.split("?")[0]!));
  if (groups.length === 0) return <NoAccess />;

  return (
    <div className="flex flex-col gap-6">
      <div className="relative w-full sm:w-96">
        <Search
          aria-hidden="true"
          className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a setting, for example late fee"
          aria-label="Find a setting"
          className="bg-surface h-10 pl-8"
        />
      </div>
      {query.trim() ? (
        <Panel title="Matching settings">
          {results.length === 0 ? (
            <p className="text-muted-foreground text-sm">No setting matches. Try another word.</p>
          ) : (
            <ul className="flex flex-col gap-3" aria-label="Matching settings">
              {results.map(({ id, info }) => (
                <li key={id}>
                  <Link
                    href={`${info.href}#${settingControlId(id)}-row`}
                    className="text-brand-ink font-medium underline-offset-2 hover:underline"
                  >
                    {info.label}
                  </Link>
                  <p className="text-muted-foreground text-xs">{info.helper}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      ) : null}
      <div className="grid gap-6 md:grid-cols-2">
        {groups.map(({ group, label, items }) => (
          <Panel key={group} title={label}>
            <ul className="flex flex-col gap-3">
              {items.map((item) => (
                <li key={item.href} className="flex gap-3">
                  <item.icon aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <span>
                    <Link href={item.href} className="font-medium underline-offset-2 hover:underline">
                      {item.label}
                    </Link>
                    <span className="text-muted-foreground block text-sm">{item.description}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </div>
  );
}
