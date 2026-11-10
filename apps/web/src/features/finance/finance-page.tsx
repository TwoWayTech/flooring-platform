"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { featureOn } from "@workspace/shared";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/components/tabs";
import { NoAccess } from "@/components/no-access";
import { useCan } from "@/components/workspace/workspace-context";
import { PaymentsQueue, usePaymentsQueueAllowed } from "./payments-queue";
import { ExpensesView } from "./expenses/expenses-view";

type View = "payments" | "expenses";

/**
 * Finance (plan K-7): where money waits for a decision. Payments to verify is the two-person check
 * in one place; Expenses records what the company spends, per location.
 */
export function FinancePage() {
  const can = useCan();
  const router = useRouter();
  const params = useSearchParams();
  const allowed: Record<View, boolean> = {
    payments: usePaymentsQueueAllowed(),
    expenses: featureOn("finance.expenses") && can("finance.expense.view"),
  };
  const views = (Object.keys(allowed) as View[]).filter((v) => allowed[v]);
  if (views.length === 0) return <NoAccess />;
  const asked = params.get("view") as View | null;
  const view = asked && allowed[asked] ? asked : views[0]!;
  return (
    <>
      <PageHeader title="Finance" />
      <Tabs value={view} className="gap-6" onValueChange={(v) => router.replace(`/finance?view=${v}`)}>
        <TabsList aria-label="Finance view">
          {allowed.payments ? <TabsTrigger value="payments">Payments to verify</TabsTrigger> : null}
          {allowed.expenses ? <TabsTrigger value="expenses">Expenses</TabsTrigger> : null}
        </TabsList>
        <TabsContent value={view} className="flex flex-col gap-4">
          {view === "payments" ? <PaymentsQueue /> : <ExpensesView />}
        </TabsContent>
      </Tabs>
    </>
  );
}
