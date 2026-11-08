"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { defaultWarehouse } from "@workspace/shared";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Field } from "@/components/field";
import { WarehouseSelect } from "@/components/warehouse-select";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { api } from "@/lib/api";
import { useApiQuery } from "@/lib/api/use-api";

/** The value meaning "use the company default" in the profile's warehouse choice. */
const COMPANY_DEFAULT = "company";

/**
 * Your profile (spec A1): the warehouse new quotes, invoices and orders start from. Choosing the
 * company default clears the person's own choice.
 */
export function ProfileDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useWorkspace();
  const locations = useApiQuery((client) => client.list("locations"), []);
  const [choice, setChoice] = useState(user.defaultLocationId ?? COMPANY_DEFAULT);
  const [saving, setSaving] = useState(false);
  const list = locations.status === "ready" ? locations.data : [];
  const companyDefault = defaultWarehouse(list, null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api.updateMyProfile({ defaultLocationId: choice === COMPANY_DEFAULT ? null : choice });
      toast.success("Profile saved");
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface sm:max-w-md">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Your profile</DialogTitle>
            <DialogDescription>{user.name}</DialogDescription>
          </DialogHeader>
          <Field
            id="profile-warehouse"
            label="Default warehouse"
            hint="New quotes, invoices and purchase orders start from this warehouse."
          >
            <WarehouseSelect
              id="profile-warehouse"
              label="Default warehouse"
              className="w-full"
              locations={list}
              value={choice}
              onChange={setChoice}
              extraOption={{ value: COMPANY_DEFAULT, label: `Company default (${companyDefault?.name ?? "none"})` }}
            />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              Save profile
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
