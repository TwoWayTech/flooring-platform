import { CalendarClock, CalendarDays, Clock, LayoutDashboard, UsersRound } from "lucide-react";
import { SETTINGS_MENU } from "./settings-menu";
import type { ProductConfig } from "./types";

/** HR Suite: HR and Meetings only, so an HR-only company never sees flooring menus (spec "HR host"). */
export const HR: ProductConfig = {
  key: "hr",
  name: "HR Suite",
  menu: [
    { label: "HR dashboard", href: "/", icon: LayoutDashboard, anyOf: ["hr.overview.view"] },
    { label: "Employees", href: "/hr/employees", icon: UsersRound, anyOf: ["hr.employee.view"] },
    { label: "Timesheets", href: "/hr/timesheets", icon: Clock, anyOf: ["hr.timesheet.view"] },
    { label: "Time off", href: "/hr/time-off", icon: CalendarClock, anyOf: ["hr.pto.view"] },
    { label: "Meetings", href: "/meetings", icon: CalendarDays, anyOf: ["meetings.meeting.view"] },
  ],
  settings: SETTINGS_MENU,
  defaultBranding: { brandColor: "#1F6FA8", pattern: "basketweave" },
};
