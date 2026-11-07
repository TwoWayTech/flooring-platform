"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { US_STATES, ZIP_PATTERN, type CompanyProfile } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Panel } from "@workspace/ui/components/panel";
import { Field } from "@/components/field";
import { NoAccess } from "@/components/no-access";
import { useCan, useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";

const STATE_CODES = US_STATES.map(([code]) => code) as [string, ...string[]];

/** What a valid profile looks like; messages say what to fix (design brief "Copy"). */
const ProfileSchema = z.object({
  legalName: z.string().trim().min(1, "Enter the legal name on your tax filings."),
  dba: z.string().trim(),
  ein: z.string().regex(/^\d{2}-\d{7}$/, "Enter the EIN as 12-3456789."),
  phone: z.string().trim().min(7, "Enter a phone number customers can call."),
  email: z.email("Enter a valid email address."),
  website: z.string().trim(),
  address: z.object({
    street: z.string().trim().min(1, "Enter the street address."),
    city: z.string().trim().min(1, "Enter the city."),
    state: z.enum(STATE_CODES, "Use a two-letter state code, for example CO."),
    zip: z.string().regex(ZIP_PATTERN, "Enter a ZIP such as 80202 or 80202-1234."),
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
  | "address.zip";

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
];

/** Settings: Company profile, validated inline; the profile appears on invoices and PDFs. */
export function CompanyProfilePage() {
  const can = useCan();
  const { settings } = useWorkspace();
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
    <Panel title="Company profile">
      <form onSubmit={form.handleSubmit(save)} className="flex flex-col gap-5" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map(({ name, label, className }) => {
            const error = errorOf(name);
            return (
              <Field key={name} id={`profile-${name}`} label={label} className={className}>
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
        <div className="flex justify-end">
          <Button type="submit" disabled={!form.formState.isDirty}>
            <Save />
            Save company profile
          </Button>
        </div>
      </form>
    </Panel>
  );
}
