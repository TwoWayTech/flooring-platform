"use client";

import { useState } from "react";
import { FileSignature } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Num } from "@workspace/ui/components/num";
import { Panel } from "@workspace/ui/components/panel";
import { Field } from "@/components/field";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import type { MyPortal } from "@/lib/api/contract";
import { useFormatDate } from "@/lib/use-format-date";
import { MyShell } from "./my-shell";

const STATUS_TEXT = { draft: "Open", approved: "Approved, waiting for payroll", paid: "Paid" } as const;

function SignPlan({ portal }: { portal: MyPortal }) {
  const { user } = useWorkspace();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { assignment, plan } = portal;
  if (!assignment || !plan || assignment.acknowledgement) return null;
  async function sign() {
    try {
      await api.acknowledgePlan(assignment!.id, name);
      toast.success("Plan signed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not sign this plan.");
    }
  }
  return (
    <Panel title={`Sign your plan: ${plan.name}`}>
      <div className="flex flex-col gap-3 text-sm">
        <p>
          Commission is advanced when a customer payment is confirmed and earned when the {plan.clawbackDays}-day window
          closes. Type your name to acknowledge the plan. In a live system this would be an e-signature and you would
          keep a signed copy.
        </p>
        <Field id="sign-name" label={`Type "${user.name}"`}>
          <Input id="sign-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {error ? (
          <p role="alert" className="text-danger-ink">
            {error}
          </p>
        ) : null}
        <div>
          <Button onClick={() => void sign()}>
            <FileSignature />
            Sign plan
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function Commission({ portal }: { portal: MyPortal }) {
  const formatDate = useFormatDate();
  const pending = portal.statements.filter((s) => s.status !== "paid").reduce((t, s) => t + Number(s.payable), 0);
  return (
    <div className="flex flex-col gap-4">
      <SignPlan portal={portal} />
      <Panel title="Waiting to be paid">
        <p className="font-display text-2xl font-semibold">
          <Num kind="money" value={String(pending)} />
        </p>
      </Panel>
      {portal.statements.map((s) => (
        <Panel
          key={s.month}
          title={s.month}
          actions={<span className="text-muted-foreground text-sm">{STATUS_TEXT[s.status]}</span>}
        >
          <dl className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Commission</dt>
              <dd>
                <Num kind="money" value={s.net} />
              </dd>
            </div>
            <div className="flex justify-between font-medium">
              <dt>Payable</dt>
              <dd>
                <Num kind="money" value={s.payable} />
              </dd>
            </div>
          </dl>
          {s.lines.length > 0 ? (
            <ul className="divide-hairline mt-2 divide-y text-sm">
              {s.lines.map((l) => (
                <li key={l.id} className="flex justify-between gap-3 py-1">
                  <span className="text-muted-foreground">
                    {formatDate(l.confirmedOn)}
                    {l.base === null ? null : (
                      <>
                        , on <Num kind="money" value={l.base} />
                      </>
                    )}
                  </span>
                  <Num kind="money" value={l.commission} />
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      ))}
    </div>
  );
}

/** My commission (spec C2): only when HR has made it visible. Shows the rep's own base per plan N-5. */
export function MyCommissionPage() {
  return (
    <MyShell title="My commission">
      {(p) =>
        p.visible.commission ? (
          <Commission portal={p} />
        ) : (
          <p className="text-muted-foreground">Commission is not shown here.</p>
        )
      }
    </MyShell>
  );
}
