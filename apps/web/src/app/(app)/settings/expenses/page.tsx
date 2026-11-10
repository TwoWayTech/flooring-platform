import type { Metadata } from "next";
import { ExpensesSettingsPage } from "@/features/settings/expenses/expenses-settings-page";

export const metadata: Metadata = { title: "Expense settings" };

/** Settings → Expenses. */
export default function Page() {
  return <ExpensesSettingsPage />;
}
