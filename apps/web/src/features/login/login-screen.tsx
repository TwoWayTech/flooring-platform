"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { featureOn, type ProductKey } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { BrandStyle } from "@workspace/ui/components/brand-style";
import { FloorPattern } from "@workspace/ui/components/floor-pattern";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { cn } from "@workspace/ui/lib/utils";
import { signIn } from "@/lib/session/client";
import { PRODUCTS } from "@/products";
import { CodeStep } from "./code-step";
import { useLoginDirectory, type LoginCompany, type Persona } from "./use-login-directory";

type Choice = { kind: "persona"; persona: Persona } | { kind: "platform" } | null;

/** A numbered step: company, persona, code is a real sequence, so the numbers carry meaning. */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`} className="flex flex-col gap-3">
      <h2 id={`step-${n}`} className="flex items-center gap-2 text-sm font-semibold">
        <span className="bg-raised text-muted-foreground grid size-5 place-items-center rounded-full text-2xs tabular-nums">
          {n}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function CompanyChip({ entry, selected, onSelect }: { entry: LoginCompany; selected: boolean; onSelect: () => void }) {
  const { company, directory } = entry;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "flex min-w-0 flex-1 items-center gap-3 rounded-md border p-2 text-left transition-colors",
        selected ? "border-brand bg-brand-soft" : "border-hairline hover:bg-raised",
      )}
    >
      <BrandStyleScope color={directory.branding.brandColor}>
        <FloorPattern
          pattern={directory.branding.pattern}
          width={64}
          height={64}
          unit={6}
          strength="strong"
          className="size-8 shrink-0 overflow-hidden rounded-sm"
        />
      </BrandStyleScope>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{company.name}</span>
        <span className="text-muted-foreground block text-xs">
          {company.city}, {company.state}
        </span>
      </span>
    </button>
  );
}

/** Scopes a brand color to one swatch, so each company chip shows its own color. */
function BrandStyleScope({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="contents" style={{ ["--brand" as string]: color }}>
      {children}
    </span>
  );
}

function PersonaCard({ persona, selected, onSelect }: { persona: Persona; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition-colors",
        selected ? "border-brand bg-brand-soft" : "border-hairline hover:bg-raised",
      )}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-x-2">
        <span className="text-sm font-semibold">{persona.user.name}</span>
        <span className="text-brand-ink shrink-0 text-xs font-medium">{persona.role.name}</span>
      </span>
      <span className="text-muted-foreground text-xs">{persona.role.description}</span>
    </button>
  );
}

/**
 * The demo sign-in (spec section 2): pick a company, a persona, then pass a simulated MFA step.
 * The company's floor pattern lays itself behind the panel (the product's one decorative motion).
 */
export function LoginScreen({ product }: { product: ProductKey }) {
  const router = useRouter();
  const config = PRODUCTS[product];
  const directory = useLoginDirectory(product);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>(null);
  const [pending, setPending] = useState(false);

  const companies = directory.data ?? [];
  const selected = companies.find((c) => c.company.id === companyId) ?? companies[0];
  const branding = selected?.directory.branding ?? { ...config.defaultBranding };

  async function complete() {
    if (!choice || !selected) return;
    setPending(true);
    try {
      if (choice.kind === "platform") {
        await signIn({ kind: "platform" });
        router.replace("/admin");
      } else {
        const { user, role } = choice.persona;
        await signIn({ kind: "company", companyId: selected.company.id, userId: user.id, roleKey: role.key });
        router.replace("/");
      }
      router.refresh();
    } catch (error) {
      setPending(false);
      toast.error(error instanceof Error ? error.message : "Sign-in failed. Try again.");
    }
  }

  return (
    <div className="bg-background relative min-h-dvh overflow-hidden">
      <BrandStyle color={branding.brandColor} />
      <FloorPattern key={branding.pattern} pattern={branding.pattern} animate className="absolute inset-0 size-full" />
      <div className="relative flex min-h-dvh flex-col pt-28 sm:p-6 sm:pt-6 lg:p-12">
        <main className="bg-surface border-hairline sm:rounded-dialog flex w-full flex-1 flex-col gap-7 rounded-t-dialog border p-6 shadow-lg sm:max-w-[480px] sm:flex-none sm:p-8">
          <header className="flex flex-col gap-1">
            <p className="font-display text-2xl font-semibold tracking-[-0.01em]">{config.name}</p>
            <p className="text-muted-foreground">Pick a company and a persona to see the product as they would.</p>
          </header>

          {directory.status === "loading" ? (
            <div className="flex flex-col gap-3" aria-busy="true" aria-label="Loading companies">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : directory.status === "error" ? (
            <p className="text-danger-ink">The demo data did not load. Reload the page to try again.</p>
          ) : (
            <>
              <Step n={1} title="Company">
                <div className="flex flex-col gap-2 sm:flex-row">
                  {companies.map((entry) => (
                    <CompanyChip
                      key={entry.company.id}
                      entry={entry}
                      selected={entry.company.id === selected?.company.id}
                      onSelect={() => {
                        setCompanyId(entry.company.id);
                        setChoice(null);
                      }}
                    />
                  ))}
                </div>
              </Step>

              <Step n={2} title="Persona">
                <div role="radiogroup" aria-labelledby="step-2" className="grid gap-2 sm:grid-cols-2">
                  {(selected?.personas ?? []).map((persona) => (
                    <PersonaCard
                      key={persona.user.id}
                      persona={persona}
                      selected={choice?.kind === "persona" && choice.persona.user.id === persona.user.id}
                      onSelect={() => setChoice({ kind: "persona", persona })}
                    />
                  ))}
                </div>
                {featureOn("admin.access") ? (
                  <button
                    type="button"
                    onClick={() => setChoice({ kind: "platform" })}
                    aria-pressed={choice?.kind === "platform"}
                    className={cn(
                      "flex items-center gap-3 rounded-md border border-dashed p-3 text-left transition-colors",
                      choice?.kind === "platform" ? "border-brand bg-brand-soft" : "border-hairline hover:bg-raised",
                    )}
                  >
                    <ShieldCheck aria-hidden="true" className="text-muted-foreground size-5 shrink-0" />
                    <span>
                      <span className="block text-sm font-semibold">Platform admin (you)</span>
                      <span className="text-muted-foreground block text-xs">Companies, plans, modules and access</span>
                    </span>
                  </button>
                ) : null}
              </Step>

              {choice && featureOn("auth.mfa") ? (
                <Step n={3} title="Verify it is you">
                  <CodeStep
                    key={choice.kind === "platform" ? "platform" : choice.persona.user.id}
                    who={choice.kind === "platform" ? "platform admin" : choice.persona.user.name}
                    pending={pending}
                    onSubmit={() => void complete()}
                  />
                </Step>
              ) : choice ? (
                <Button size="lg" className="h-10 self-start" disabled={pending} onClick={() => void complete()}>
                  {pending
                    ? "Signing in"
                    : `Sign in as ${choice.kind === "platform" ? "platform admin" : choice.persona.user.name}`}
                </Button>
              ) : null}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
