import type { PermissionKey } from "../permissions/catalog";
import type { DataScope } from "../permissions/roles";
import type { ModuleKey, ProductKey } from "../products";

/** Ids of the three demo companies (spec section 3). */
export type CompanyId = "summit" | "keystone" | "harbor";

/** Laying patterns used as each company's signature element. */
export type FloorPattern = "herringbone" | "running-bond" | "basketweave";

/** A street address. */
export interface Address {
  street: string;
  city: string;
  state: string;
  zip: string;
}

/** A branch (store or warehouse) of a company. */
export interface Branch {
  id: string;
  name: string;
  city: string;
  state: string;
}

/** Subscription status shown in super-admin. */
export type CompanyStatus = "active" | "trial" | "past_due" | "suspended";

/** A tenant. Platform-level fields (modules, ceiling, limits) are owned by the super-admin. */
export interface Company {
  id: CompanyId;
  name: string;
  city: string;
  state: string;
  product: ProductKey;
  modules: ModuleKey[];
  plan: string;
  status: CompanyStatus;
  userLimit: number;
  branchLimit: number;
  /** Permission ceiling set by the platform super-admin. */
  ceiling: PermissionKey[];
  branches: Branch[];
  createdAt: string;
}

/** Branding a company controls in Settings: Branding. */
export interface Branding {
  displayName: string;
  monogram: string;
  brandColor: string;
  pattern: FloorPattern;
  /** Data URL of an uploaded logo, or null for the generated monogram. */
  logoDataUrl: string | null;
  defaultTheme: "light" | "dark" | "system";
}

/** A role inside one company. */
export interface Role {
  id: string;
  companyId: CompanyId;
  key: string;
  name: string;
  description: string;
  permissions: PermissionKey[];
  dataScope: DataScope;
  /** Shipped by the platform (can be copied, not deleted). */
  system: boolean;
  /** The superuser role: holds everything inside the ceiling, locked. */
  owner: boolean;
}

/** User lifecycle status; users are disabled, never deleted. */
export type UserStatus = "invited" | "active" | "disabled";

/** A user of one company. */
export interface User {
  id: string;
  companyId: CompanyId;
  name: string;
  email: string;
  title: string;
  roleIds: string[];
  branchId: string;
  status: UserStatus;
  mfaEnrolled: boolean;
  lastLoginAt: string | null;
  employeeId: string | null;
}
