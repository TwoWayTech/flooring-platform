import { describe, expect, it } from "vitest";
import {
  contactProblem,
  contactsOf,
  findSimilarSupplier,
  normalizeCompanyName,
  searchSuppliers,
  supplierProfileGaps,
  whatsappLink,
  type Supplier,
  type SupplierContact,
} from "../src";

const supplier = (id: string, name: string, patch: Partial<Supplier> = {}) =>
  ({
    id,
    name,
    status: "active",
    accountNumber: "",
    email: "",
    phone: "",
    address: { street: "1 Main", city: "Denver", state: "CO", zip: "80202" },
    ...patch,
  }) as Supplier;
const contact = (id: string, supplierId: string, patch: Partial<SupplierContact> = {}) =>
  ({
    id,
    supplierId,
    name: id,
    role: "sales_rep",
    mobile: "",
    officePhone: "",
    email: "",
    whatsapp: false,
    isPrimary: false,
    status: "active",
    ...patch,
  }) as SupplierContact;

describe("supplier directory (spec B1, B2, ADR 0022)", () => {
  it("spots a duplicate whatever the case, punctuation or company suffix", () => {
    expect(normalizeCompanyName("Northline Mills, Inc.")).toBe("northline mills");
    expect(findSimilarSupplier("NORTHLINE MILLS LLC", [supplier("a", "Northline Mills")])?.id).toBe("a");
    expect(findSimilarSupplier("Northline", [supplier("a", "Northline Mills")])).toBeUndefined();
  });

  it("says what is missing from a profile", () => {
    const bare = supplier("a", "New Co", { address: { street: "", city: "", state: "", zip: "" } });
    expect(supplierProfileGaps(bare, [])).toEqual(["an address", "a way to reach them"]);
    expect(supplierProfileGaps(bare, [contact("c", "a", { mobile: "303 555 0100" })])).toEqual(["an address"]);
  });

  it("orders contacts primary first, accounts receivable last, and leaves out inactive ones", () => {
    const list = [
      contact("ar", "a", { role: "accounts_receivable" }),
      contact("rep", "a"),
      contact("boss", "a", { role: "account_manager", isPrimary: true }),
      contact("gone", "a", { status: "inactive" }),
    ];
    expect(contactsOf("a", list).map((c) => c.id)).toEqual(["boss", "rep", "ar"]);
  });

  it("finds a supplier by its own details or any contact's, phones by digits", () => {
    const suppliers = [supplier("a", "Northline Mills", { accountNumber: "ACC-77" }), supplier("b", "Loomcraft")];
    const contacts = [
      contact("sonny", "b", { name: "Sonny Heller", mobile: "(303) 555-0142", email: "sonny@loom.example" }),
    ];
    expect(searchSuppliers("north", suppliers, contacts).map((m) => m.supplier.id)).toEqual(["a"]);
    expect(searchSuppliers("acc-77", suppliers, contacts).map((m) => m.supplier.id)).toEqual(["a"]);
    expect(searchSuppliers("555-0142", suppliers, contacts)[0]).toMatchObject({
      supplier: { id: "b" },
      via: { id: "sonny" },
    });
    expect(searchSuppliers("heller", suppliers, contacts)[0]?.supplier.id).toBe("b");
    expect(searchSuppliers("", suppliers, contacts)).toHaveLength(2);
  });

  it("needs a name and a way to reach the contact", () => {
    const base = { name: "Ann", email: "", mobile: "", officePhone: "", whatsapp: false };
    expect(contactProblem({ ...base, name: " " })).toMatch(/name/);
    expect(contactProblem(base)).toMatch(/email or a phone/);
    expect(contactProblem({ ...base, officePhone: "303", whatsapp: true })).toMatch(/WhatsApp/);
    expect(contactProblem({ ...base, email: "a@b.example" })).toBeNull();
  });

  it("builds a WhatsApp link with the country code", () => {
    expect(whatsappLink("(303) 555-0142")).toBe("https://wa.me/13035550142");
  });
});
