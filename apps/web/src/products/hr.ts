import { CalendarClock, CalendarDays, Clock, LayoutDashboard, UsersRound } from "lucide-react";
import { SETTINGS_MENU, type SettingsGroup } from "./settings-menu";

/** The settings groups an HR-only company uses; sales, stock, payments and commissions are flooring. */
const HR_SETTINGS_GROUPS: SettingsGroup[] = ["company", "people", "tax", "data"];
import type { ProductConfig } from "./types";

/** HR Suite: HR and Meetings only, so an HR-only company never sees flooring menus (spec "HR host"). */
export const HR: ProductConfig = {
  key: "hr",
  name: "HR Suite",
  menu: [
    {
      label: "HR dashboard",
      href: "/",
      icon: LayoutDashboard,
      anyOf: ["hr.overview.view"],
      features: ["hr.dashboard"],
    },
    {
      label: "Employees",
      href: "/hr/employees",
      icon: UsersRound,
      anyOf: ["hr.employee.view"],
      features: ["hr.employees"],
    },
    {
      label: "Timesheets",
      href: "/hr/timesheets",
      icon: Clock,
      anyOf: ["hr.timesheet.view"],
      features: ["hr.timesheets"],
    },
    { label: "Time off", href: "/hr/time-off", icon: CalendarClock, anyOf: ["hr.pto.view"], features: ["hr.time-off"] },
    {
      label: "Meetings",
      href: "/meetings",
      icon: CalendarDays,
      anyOf: ["meetings.meeting.view"],
      features: ["meetings.calendar"],
    },
  ],
  settings: SETTINGS_MENU.filter((item) => item.group && HR_SETTINGS_GROUPS.includes(item.group)),
  defaultBranding: { brandColor: "#1F6FA8", pattern: "basketweave" },
};
