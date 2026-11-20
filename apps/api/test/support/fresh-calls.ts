import type { ImportRequest, ProductKey, Role } from "@workspace/shared";
import type { Call } from "./money-actions";

/** A meeting's start as the API takes it: a local time in the company's zone, `yyyy-MM-ddTHH:mm`. */
export type LocalTime = `${string}T${string}`;

/**
 * The requests behind the bare-company steps of the whole-product check (FA; plan section 5.2)
 * that are not money events, with bodies copied from the existing integration tests and checked
 * against the controllers' Zod schemas. Money events come from `moneyCalls`.
 */
export const freshCalls = {
  /** POST /users/invite: invites a person with one role and no branch (step-up). */
  invite: (name: string, email: string, roleId: string): Call => ({
    verb: "post",
    path: "/users/invite",
    body: { name, email, title: "", roleIds: [roleId], branchId: "" },
  }),

  /** PUT /roles/:id: saves a role as it stands with a new description (step-up). */
  roleSave: (role: Role, description: string): Call => ({
    verb: "put",
    path: `/roles/${role.id}`,
    body: { name: role.name, description, dataScope: role.dataScope, permissions: role.permissions },
  }),

  /** POST /supplier-contacts: a sales rep reached by email. */
  supplierContact: (supplierId: string, name: string, email: string): Call => ({
    verb: "post",
    path: "/supplier-contacts",
    body: {
      supplierId,
      name,
      role: "sales_rep",
      mobile: "",
      officePhone: "",
      email,
      whatsapp: false,
      preferredMethod: "email",
      notes: "",
      isPrimary: false,
    },
  }),

  /** POST /meetings: an hour at the showroom with no guests. */
  meeting: (title: string, start: LocalTime): Call => ({
    verb: "post",
    path: "/meetings",
    body: {
      title,
      start,
      durationMin: 60,
      location: "Showroom",
      guests: [],
      newGuests: [],
      recurrence: "none",
      reminderMin: 15,
      notes: "",
      private: false,
      hideGuestList: false,
      allowProposals: true,
    },
  }),

  /** POST /meetings/:id/cancel: cancels a meeting for everyone. */
  meetingCancel: (id: string): Call => ({ verb: "post", path: `/meetings/${id}/cancel` }),

  /** POST /imports/check: the dry run, which writes nothing. */
  importCheck: (file: ImportRequest): Call => ({ verb: "post", path: "/imports/check", body: file }),

  /** POST /imports: imports a file with the dry run's actions as `expected` (step-up). */
  importCommit: (file: ImportRequest, expected: string): Call => ({
    verb: "post",
    path: "/imports",
    body: { ...file, expected },
  }),

  /** POST /imports/:id/undo: undoes a batch (step-up). */
  importUndo: (batchId: string): Call => ({ verb: "post", path: `/imports/${batchId}/undo` }),

  /** POST /employees: an hourly W-2 employee, as the HR tests add one. */
  employee: (name: string, email: string, product: ProductKey): Call => ({
    verb: "post",
    path: "/employees",
    product,
    body: {
      name,
      title: "Installer",
      department: "Field",
      workerType: "w2",
      payType: "hourly",
      payRate: "31.75",
      state: "TX",
      email,
      phone: "555-0100",
      hiredAt: "2025-03-03",
      status: "active",
      managerId: null,
      flsaStatus: "non_exempt",
      exemptionBasis: null,
      salaryHoursPerWeek: 40,
      commissionVisible: null,
      homeLocationId: null,
      emergencyContact: null,
    },
  }),

  /**
   * POST /pay-periods with no date: opens the period holding today, as the web's `listPayPeriods`
   * does before it lists them (apps/web api-methods.ts).
   */
  openCurrentPayPeriod: (product: ProductKey): Call => ({ verb: "post", path: "/pay-periods", body: {}, product }),

  /** A read, as a product's web host sends it. */
  read: (path: string, product?: ProductKey): Call => ({ verb: "get", path, product }),
};
