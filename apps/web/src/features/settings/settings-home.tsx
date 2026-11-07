"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { NoAccess } from "@/components/no-access";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { visibleItems } from "@/products";

/** "/settings" opens the first settings page the viewer may use. */
export function SettingsHome() {
  const router = useRouter();
  const { product, access } = useWorkspace();
  const first = visibleItems(product.settings, access)[0];
  useEffect(() => {
    if (first) router.replace(first.href);
  }, [first, router]);
  return first ? null : <NoAccess />;
}
