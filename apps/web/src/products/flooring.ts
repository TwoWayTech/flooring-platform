import { BarChart3, CalendarDays, Hammer, LayoutDashboard, Layers, Receipt, Truck, UsersRound } from "lucide-react";
import { SETTINGS_MENU } from "./settings-menu";
import type { ProductConfig } from "./types";

/** Flooring Suite: menus in the order of the design brief's app shell. */
export const FLOORING: ProductConfig = {
  key: "flooring",
  name: "Flooring Suite",
  menu: [
    {
      label: "Dashboard",
      href: "/",
      icon: LayoutDashboard,
      anyOf: ["dashboard.overview.view"],
      features: ["dashboard.store"],
    },
    {
      label: "Sales",
      href: "/sales",
      icon: Receipt,
      anyOf: ["sales.quote.view", "sales.invoice.view", "customers.customer.view"],
      features: ["sales.quotes", "sales.invoices", "sales.customers"],
    },
    {
      label: "Inventory",
      href: "/inventory",
      icon: Layers,
      anyOf: ["inventory.product.view", "inventory.roll.view"],
      features: ["inventory.products", "inventory.rolls"],
    },
    {
      label: "Purchasing",
      href: "/purchasing",
      icon: Truck,
      anyOf: ["purchasing.order.view", "purchasing.bill.view"],
      features: ["purchasing.orders"],
    },
    {
      label: "Installation",
      href: "/installation",
      icon: Hammer,
      anyOf: ["installation.job.view"],
      features: ["installation.calendar"],
    },
    {
      label: "HR",
      href: "/hr",
      icon: UsersRound,
      anyOf: ["hr.overview.view", "hr.timesheet.view", "hr.pto.view"],
      features: ["hr.dashboard", "hr.employees", "hr.timesheets", "hr.time-off"],
    },
    {
      label: "Meetings",
      href: "/meetings",
      icon: CalendarDays,
      anyOf: ["meetings.meeting.view"],
      features: ["meetings.calendar"],
    },
    {
      label: "Reports",
      href: "/reports",
      icon: BarChart3,
      anyOf: ["reports.sales.view", "reports.financial.view", "reports.inventory.view", "reports.tax.view"],
      features: ["reports.hub"],
    },
  ],
  settings: SETTINGS_MENU,
  defaultBranding: { brandColor: "#2E8B7E", pattern: "herringbone" },
};
