import type { Metadata } from "next";
import { SecurityPage } from "@/features/account/security-page";

export const metadata: Metadata = { title: "Sign-in and security" };

/** Sign-in and security: two-step sign-in and passkeys (ADR 0060). */
export default function Page() {
  return <SecurityPage />;
}
