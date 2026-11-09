import {
  Banknote,
  Building2,
  FileText,
  Hash,
  History,
  Languages,
  Palette,
  ShieldCheck,
  Users,
  Warehouse,
} from "lucide-react";
import type { MenuItem } from "./types";

/** The groups of the settings home (spec A4), in display order. */
export const SETTINGS_GROUPS = {
  company: "Company",
  people: "People and access",
  sales: "Sales and documents",
  inventory: "Inventory and warehouses",
  tax: "Tax and localization",
  payments: "Payments",
  commissions: "Commissions",
  data: "Data import and integrations",
} as const;

/** A settings group key. */
export type SettingsGroup = keyof typeof SETTINGS_GROUPS;

/**
 * Settings pages both products share (blueprint: the HR host keeps its own Users, Roles and
 * Settings), grouped as on the settings home. Pages a product does not use drop out through
 * their permissions, which belong to modules that product lacks.
 */
export const SETTINGS_MENU: MenuItem[] = [
  {
    label: "Company profile",
    href: "/settings/company",
    icon: Building2,
    anyOf: ["settings.company.manage"],
    features: ["settings.company"],
    group: "company",
    description: "Legal name, EIN, contact details and the address printed on documents.",
  },
  {
    label: "Branding",
    href: "/settings/branding",
    icon: Palette,
    anyOf: ["settings.branding.manage"],
    features: ["settings.branding"],
    group: "company",
    description: "Name, logo, brand color and theme across the app.",
  },
  {
    label: "Number format",
    href: "/settings/number-format",
    icon: Hash,
    anyOf: ["settings.numbers.manage"],
    features: ["settings.number-format"],
    group: "company",
    description: "Decimals and negative numbers on screen. Display only.",
  },
  {
    label: "Users",
    href: "/settings/users",
    icon: Users,
    anyOf: ["settings.users.view", "settings.users.manage"],
    features: ["settings.users"],
    group: "people",
    description: "Invite people, change their roles, disable accounts and reset MFA.",
  },
  {
    label: "Security roles",
    href: "/settings/roles",
    icon: ShieldCheck,
    anyOf: ["settings.roles.view", "settings.roles.manage"],
    features: ["settings.roles"],
    group: "people",
    description: "What each role can see and do, and a preview of anyone's access.",
  },
  {
    label: "Audit log",
    href: "/settings/audit",
    icon: History,
    anyOf: ["settings.audit.view"],
    features: ["settings.audit"],
    group: "people",
    description: "Every change, with who made it, when, and the values before and after.",
  },
  {
    label: "Sales and documents",
    href: "/settings/documents",
    icon: FileText,
    anyOf: ["settings.localization.manage"],
    features: ["settings.localization"],
    group: "sales",
    description: "Payment terms, deposit, late fee and document numbering.",
  },
  {
    label: "Warehouses and showrooms",
    href: "/settings/locations",
    icon: Warehouse,
    anyOf: ["settings.locations.manage"],
    features: ["inventory.locations"],
    group: "inventory",
    description: "Where stock is kept and shown, and the default warehouse.",
  },
  {
    label: "Localization and tax",
    href: "/settings/localization",
    icon: Languages,
    anyOf: ["settings.localization.manage", "settings.tax.manage"],
    features: ["settings.localization"],
    group: "tax",
    description: "Region, currency, sales tax rules and payroll rules.",
  },
  {
    label: "Payments",
    href: "/settings/payments",
    icon: Banknote,
    anyOf: ["settings.payments.manage"],
    features: ["sales.payments"],
    group: "payments",
    description: "The two-person check on payments, small write-offs and payment numbering.",
  },
];
