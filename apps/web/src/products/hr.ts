import { CalendarClock, CalendarDays, Clock, LayoutDashboard, UserRound, UsersRound, Wallet } from "lucide-react";
import { SETTINGS_MENU, type SettingsGroup } from "./settings-menu";

/** The settings groups an HR-only company uses; sales, stock, payments and commissions are flooring. */
const HR_SETTINGS_GROUPS: SettingsGroup[] = ["company", "people", "tax", "notifications", "data"];
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
      label: "People",
      href: "/hr/employees",
      icon: UsersRound,
      anyOf: ["hr.employee.view"],
      features: ["hr.employees"],
    },
    {
      label: "Timesheets",
      href: "/hr/timesheets",
      icon: Clock,
      anyOf: ["hr.timesheet.approve"],
      features: ["hr.timesheets"],
    },
    {
      label: "Time off",
      href: "/hr/time-off",
      icon: CalendarClock,
      anyOf: ["hr.pto.approve"],
      features: ["hr.time-off"],
    },
    {
      label: "Pay periods",
      href: "/hr/pay-periods",
      icon: Wallet,
      anyOf: ["hr.payroll.view"],
      features: ["hr.pay-periods"],
    },
    { label: "My portal", href: "/my", icon: UserRound, anyOf: ["hr.portal.view"], features: ["hr.portal"] },
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
