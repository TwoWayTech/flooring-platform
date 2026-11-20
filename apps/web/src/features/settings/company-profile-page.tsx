"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import {
  EIN_PATTERN,
  EMAIL_TEXT,
  PROFILE_MESSAGES,
  US_STATES,
  WEBSITE_TEXT,
  ZIP_PATTERN,
  type CompanyProfile,
} from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Panel } from "@workspace/ui/components/panel";
import { cn } from "@workspace/ui/lib/utils";
import { Field } from "@/components/field";
import { NoAccess } from "@/components/no-access";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";
import { SaveBar } from "./form/save-bar";
import { AddressSearchField } from "@/components/address/address-search-field";
import { fillAddress } from "@/components/address/fill-address";

/** How many fields React Hook Form marks dirty, nested ones included. */
function countDirty(dirty: object): number {
  return Object.values(dirty).reduce<number>((n, v) => n + (typeof v === "object" ? countDirty(v) : v ? 1 : 0), 0);
}

const STATE_CODES = US_STATES.map(([code]) => code) as [string, ...string[]];

/**
 * What a valid profile looks like, inline as the person types; messages say what to fix (design
 * brief "Copy"). The patterns and words are the shared `companyProfileProblem`'s, which DemoStore
 * and the API run on save (spec rule 28; ADR 0059), so the page and the server can't drift.
 */
const ProfileSchema = z.object({
  legalName: z.string().trim().min(1, PROFILE_MESSAGES.legalName),
  dba: z.string().trim(),
  ein: z.string().regex(EIN_PATTERN, PROFILE_MESSAGES.ein),
  phone: z.string().trim().min(7, PROFILE_MESSAGES.phone),
  email: z.string().trim().regex(EMAIL_TEXT, PROFILE_MESSAGES.email),
  website: z
    .string()
    .trim()
    .refine((value) => value === "" || WEBSITE_TEXT.test(value), PROFILE_MESSAGES.website),
  address: z.object({
    street: z.string().trim().min(1, PROFILE_MESSAGES.street),
    city: z.string().trim().min(1, PROFILE_MESSAGES.city),
    state: z.enum(STATE_CODES, PROFILE_MESSAGES.state),
    zip: z.string().regex(ZIP_PATTERN, PROFILE_MESSAGES.zip),
    county: z.string().trim().optional(),
  }),
});

type FieldPath =
  | "legalName"
  | "dba"
  | "ein"
  | "phone"
  | "email"
  | "website"
  | "address.street"
  | "address.city"
  | "address.state"
  | "address.zip"
  | "address.county";

const FIELDS: { name: FieldPath; label: string; className?: string }[] = [
  { name: "legalName", label: "Legal name", className: "sm:col-span-2" },
  { name: "dba", label: "Doing business as" },
  { name: "ein", label: "EIN" },
  { name: "phone", label: "Phone" },
  { name: "email", label: "Email" },
  { name: "website", label: "Website", className: "sm:col-span-2" },
  { name: "address.street", label: "Street", className: "sm:col-span-2" },
  { name: "address.city", label: "City" },
  { name: "address.state", label: "State" },
  { name: "address.zip", label: "ZIP" },
  { name: "address.county", label: "County" },
];

/**
 * Settings: Company profile (spec A4), validated inline with focus on the first error; changed
 * fields are marked and saved from the sticky bar. The profile appears on invoices and PDFs.
 */
export function CompanyProfilePage() {
  const can = useCan();
  const { settings } = useWorkspace();
  const defaults = useApiQuery((client) => client.getDefaultSettings(), []);
  const form = useForm<CompanyProfile>({
    resolver: zodResolver(ProfileSchema),
    defaultValues: settings.profile,
    mode: "onTouched",
  });
  if (!can("settings.company.manage")) return <NoAccess />;

  const errorOf = (name: FieldPath) => {
    const [head, tail] = name.split(".") as [keyof CompanyProfile, string | undefined];
    const e = form.formState.errors[head] as { message?: string; [k: string]: unknown } | undefined;
    return (tail ? (e?.[tail] as { message?: string } | undefined)?.message : e?.message) ?? undefined;
  };

  async function save(profile: CompanyProfile) {
    await api.updateSettings("profile", profile);
    form.reset(profile);
    toast.success("Company profile saved");
  }

  return (
    <Panel bodyClassName="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Button
          className="ml-auto"
          variant="ghost"
          size="sm"
          disabled={defaults.status !== "ready"}
          onClick={() =>
            defaults.status === "ready" &&
            form.reset(defaults.data.profile, { keepDefaultValues: true, keepDirty: false })
          }
        >
          <RotateCcw />
          Reset to default
        </Button>
      </div>
      <form onSubmit={form.handleSubmit(save)} className="flex flex-col gap-5" noValidate>
        <AddressSearchField
          id="profile-address-search"
          label="Find the company address"
          near={settings.localization.region.primaryState}
          onSelect={(address) => fillAddress(form.setValue, address)}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map(({ name, label, className }) => {
            const error = errorOf(name);
            const changed = form.getFieldState(name).isDirty;
            return (
              <Field
                key={name}
                id={`profile-${name}`}
                label={changed ? `${label} (changed)` : label}
                className={cn(
                  className,
                  "rounded-md border-l-2 border-transparent pl-3",
                  changed && "border-brand bg-brand-soft/40",
                )}
              >
                <Input
                  id={`profile-${name}`}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `profile-${name}-error` : undefined}
                  {...form.register(name)}
                />
                {error ? (
                  <p id={`profile-${name}-error`} className="text-danger-ink text-xs">
                    {error}
                  </p>
                ) : null}
              </Field>
            );
          })}
        </div>
        <SaveBar
          changes={countDirty(form.formState.dirtyFields)}
          saveLabel="Save company profile"
          saving={form.formState.isSubmitting}
          onSave={() => void form.handleSubmit(save)()}
          onDiscard={() => form.reset()}
        />
      </form>
    </Panel>
  );
}
