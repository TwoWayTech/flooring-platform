"use client";

import type { Company, DefaultRoleKey, ProductKey, Role, User } from "@workspace/shared";
import type { CompanyDirectory } from "@/lib/api/contract";
import { useApiQuery } from "@/lib/api/use-api";

/** Persona cards per product, in the order of spec section 2. */
const PERSONA_ORDER: Record<ProductKey, DefaultRoleKey[]> = {
  flooring: ["owner", "manager", "sales", "warehouse", "installer", "accountant", "hr"],
  hr: ["owner", "hr", "employee"],
};

/** One persona card: the person who signs in and the role they hold. */
export interface Persona {
  user: User;
  role: Role;
}

/** A company on the login page with its branding and personas. */
export interface LoginCompany {
  company: Company;
  directory: CompanyDirectory;
  personas: Persona[];
}

/** First active user holding each persona role; roles nobody holds get no card. */
function personasOf(directory: CompanyDirectory, product: ProductKey): Persona[] {
  return PERSONA_ORDER[product].flatMap((key) => {
    const role = directory.roles.find((r) => r.key === key);
    const user = role && directory.users.find((u) => u.status === "active" && u.roleIds.includes(role.id));
    return role && user ? [{ user, role }] : [];
  });
}

/** Companies of this host's product with their personas, read through the ApiClient (CLAUDE.md rule 1). */
export function useLoginDirectory(product: ProductKey) {
  return useApiQuery(
    async (client): Promise<LoginCompany[]> => {
      const companies = (await client.listCompanies()).filter((c) => c.product === product && c.status === "active");
      return Promise.all(
        companies.map(async (company) => {
          const directory = await client.listCompanyDirectory(company.id);
          return { company, directory, personas: personasOf(directory, product) };
        }),
      );
    },
    [product],
  );
}
