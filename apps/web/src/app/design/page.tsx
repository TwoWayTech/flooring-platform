import type { Metadata } from "next";
import { CircleCheck, CircleDashed, Clock, FileText, Receipt, Send, TriangleAlert } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { FloorPattern } from "@workspace/ui/components/floor-pattern";
import { Input } from "@workspace/ui/components/input";
import { Monogram } from "@workspace/ui/components/monogram";
import { Num } from "@workspace/ui/components/num";
import { PageHeader } from "@workspace/ui/components/page-header";
import { Panel } from "@workspace/ui/components/panel";
import { RollGauge } from "@workspace/ui/components/roll-gauge";
import { StatusPill } from "@workspace/ui/components/status-pill";
import { Swatch } from "@workspace/ui/components/swatch";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = { title: "Design system" };

const NEUTRALS = ["background", "surface", "raised", "hairline", "foreground", "muted-foreground"] as const;
const ACCENTS = ["brand", "brand-ink", "brand-soft", "oak", "success", "warning", "danger"] as const;
const SCALE = [
  ["text-2xs", "12"],
  ["text-xs", "13"],
  ["text-sm", "14"],
  ["text-base", "16"],
  ["text-lg", "19"],
] as const;

/** Reference page for the design system: tokens, type, the floor patterns and the roll gauge. */
export default function DesignPage() {
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-8">
      <PageHeader
        title="Design system"
        description="Tokens, type and the two signature components, in the current theme."
        actions={<ThemeToggle />}
      />

      <Panel title="Color tokens">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {[...NEUTRALS, ...ACCENTS].map((token) => (
            <div key={token} className="flex flex-col gap-1.5">
              <span className="border-hairline h-12 rounded-md border" style={{ background: `var(--${token})` }} />
              <span className="text-muted-foreground text-xs">{token}</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Type">
        <p className="font-display text-4xl font-semibold tracking-[-0.01em]">$412,880</p>
        <p className="font-display mt-2 text-2xl font-semibold tracking-[-0.01em]">Revenue and gross margin</p>
        <div className="mt-4 flex flex-col gap-1">
          {SCALE.map(([className, px]) => (
            <p key={className} className={className}>
              Instrument Sans {px} px: Harbor Twist in Driftwood, dye lot 22B, 12 ft wide.
            </p>
          ))}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        {(["herringbone", "running-bond", "basketweave"] as const).map((pattern) => (
          <Panel key={pattern} title={pattern} bodyClassName="p-0">
            <FloorPattern pattern={pattern} width={480} height={240} unit={18} className="h-40 w-full" />
          </Panel>
        ))}
      </div>

      <Panel title="Roll gauge">
        <div className="flex flex-col gap-6">
          <RollGauge originalFt={150} remainingFt={63} cutsFt={[24, 18, 30, 15]} label="63 ft of 150 ft left" />
          <div className="flex items-center gap-4">
            <RollGauge
              size="mini"
              originalFt={120}
              remainingFt={88}
              cutsFt={[12, 20]}
              label="88 ft of 120 ft left"
              className="w-24"
            />
            <RollGauge
              size="mini"
              originalFt={140}
              remainingFt={14}
              cutsFt={[30, 40, 26, 30]}
              label="14 ft of 140 ft left"
              className="w-24"
            />
          </div>
        </div>
      </Panel>

      <Panel title="Components">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Convert to invoice</Button>
          <Button variant="outline">Print label</Button>
          <Button variant="ghost">Cancel</Button>
          <Input placeholder="Length in ft" className="w-40" />
          <Monogram letters="SF" name="Summit Floor Co." />
          <Swatch color="#A89B86" label="Driftwood" />
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusPill tone="neutral" icon={CircleDashed} label="Draft" />
          <StatusPill tone="brand" icon={Send} label="Sent" />
          <StatusPill tone="success" icon={CircleCheck} label="Accepted" />
          <StatusPill tone="brand" icon={FileText} label="Invoiced" />
          <StatusPill tone="success" icon={Receipt} label="Paid" />
          <StatusPill tone="danger" icon={TriangleAlert} label="Overdue" />
          <StatusPill tone="warning" icon={Clock} label="Partly paid" />
        </div>
        <p className="mt-4 flex flex-wrap gap-6">
          <Num kind="money" value="12480.5" />
          <Num kind="unitCost" value="1.87254" />
          <Num kind="quantity" value="1250.75" unit="sq ft" />
          <Num kind="percent" value="38.42" />
          <Num kind="money" value="-1234" />
        </p>
      </Panel>
    </main>
  );
}
