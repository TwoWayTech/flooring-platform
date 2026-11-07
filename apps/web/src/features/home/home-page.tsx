"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { DashboardPage } from "@/features/dashboard/dashboard-page";
import { homeFor } from "@/products";

/**
 * "/" shows the product's dashboard to people allowed to see it; everyone else is sent to the
 * first page they may open, so each persona lands on its allowed home (spec "Login").
 */
export function HomePage() {
  const router = useRouter();
  const { access, product } = useWorkspace();
  const home = homeFor(product.key, access);
  useEffect(() => {
    if (home !== "/") router.replace(home);
  }, [home, router]);
  if (home !== "/") return null;
  return product.key === "flooring" ? <DashboardPage /> : null;
}
