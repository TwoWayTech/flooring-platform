import type { Metadata } from "next";
import { UsersPage } from "@/features/settings/users/users-page";

export const metadata: Metadata = { title: "Users" };

/** Settings: Users. */
export default function Page() {
  return <UsersPage />;
}
