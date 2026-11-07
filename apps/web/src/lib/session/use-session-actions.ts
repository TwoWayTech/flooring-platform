"use client";

import { useRouter } from "next/navigation";
import type { Company } from "@workspace/shared";
import { signOutRequest } from "./client";
import type { CompanySession } from "./session";
import { signInToCompany } from "./switch-company";

/** Session changes that also move the app: sign out to the login page, or switch company to its home. */
export function useSessionActions() {
  const router = useRouter();
  return {
    signOut: async () => {
      await signOutRequest();
      router.replace("/login");
      router.refresh();
    },
    switchCompany: async (target: Company, session: CompanySession) => {
      await signInToCompany(target, session);
      router.replace("/");
      router.refresh();
    },
  };
}
