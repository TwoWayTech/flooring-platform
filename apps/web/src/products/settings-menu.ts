import { Building2, Hash, History, Languages, Palette, ShieldCheck, Users } from "lucide-react";
import type { MenuItem } from "./types";

/** Settings pages both products share (blueprint: the HR host keeps its own Users, Roles and Settings). */
export const SETTINGS_MENU: MenuItem[] = [
  {
    label: "Users",
    href: "/settings/users",
    icon: Users,
    anyOf: ["settings.users.view", "settings.users.manage"],
    features: ["settings.users"],
  },
  {
    label: "Security roles",
    href: "/settings/roles",
    icon: ShieldCheck,
    anyOf: ["settings.roles.view", "settings.roles.manage"],
    features: ["settings.roles"],
  },
  {
    label: "Branding",
    href: "/settings/branding",
    icon: Palette,
    anyOf: ["settings.branding.manage"],
    features: ["settings.branding"],
  },
  {
    label: "Localization and tax",
    href: "/settings/localization",
    icon: Languages,
    anyOf: ["settings.localization.manage", "settings.tax.manage"],
    features: ["settings.localization"],
  },
  {
    label: "Number format",
    href: "/settings/number-format",
    icon: Hash,
    anyOf: ["settings.numbers.manage"],
    features: ["settings.number-format"],
  },
  {
    label: "Company profile",
    href: "/settings/company",
    icon: Building2,
    anyOf: ["settings.company.manage"],
    features: ["settings.company"],
  },
  {
    label: "Audit log",
    href: "/settings/audit",
    icon: History,
    anyOf: ["settings.audit.view"],
    features: ["settings.audit"],
  },
];
