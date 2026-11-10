# ADR 0022: Supplier directory, supplier contacts and the sales rep on a purchase order

Date: 2026-11-10. Status: accepted (the owner approved the Phase 0 plan on 2026-11-10) and built in feature batch 3.

## Context

Feature batch 3, Batch B (spec B1 and B2, client note 4) turns the Suppliers page under Purchasing into a directory that lists each supplier's people. It also puts a Supplier picker and a Sales rep picker on the purchase order, and both can add a new record on the spot. The same directory has to serve expenses in Batch F, through a supplier type of Goods, Services, Utility or Government.

Today `Supplier` (`packages/shared/src/types/purchasing.ts`) keeps one `contactName`, `email` and `phone`, and `PurchaseOrder` stores only a `supplierId`, so nothing records who an order went to. The supplier import fills those three fields (`packages/shared/src/import/kinds/suppliers.ts`). The blueprint's schema lists `contacts` beside customers and has no table for a supplier's people (blueprint page 14).

## What we learned

"(snippet)" means the claim comes from a search result extract and the page itself was not opened. The Sources section lists which is which.

### Odoo (documentation for versions 18 to 20, source for version 19)

- A vendor's people are ordinary contacts. A Person has one Company field and a Job Position. A company's Contacts & Addresses tab adds children typed Contact, Invoice, Delivery or Other, each with a name, address, email, phone or mobile, and notes ([Odoo Contacts 19.0](https://www.odoo.com/documentation/19.0/applications/essentials/contacts.html)). The page describes only one Company field per person, and a community module exists for people who belong to several companies ([partner_contact_in_several_companies](https://apps.odoo.com/apps/modules/11.0/partner_contact_in_several_companies), snippet).
- Contacts are archived, not removed. An archived contact leaves the main list and can still be found with a filter ([Odoo Contacts 19.0](https://www.odoo.com/documentation/19.0/applications/essentials/contacts.html)).
- Purchase defaults sit on the partner's Sales & Purchase tab: a default Buyer, Payment Terms, a 1099 Box, a payment method, a receipt reminder and a supplier currency ([Odoo Contacts 19.0](https://www.odoo.com/documentation/19.0/applications/essentials/contacts.html)).
- The "purchase representative" is not the vendor's person. The order field is `user_id`, labelled Buyer: an internal user who defaults to whoever makes the order. Choosing a vendor that has a default buyer fills that field, along with the payment terms and currency ([purchase_order.py](https://raw.githubusercontent.com/odoo/odoo/19.0/addons/purchase/models/purchase_order.py)).
- The standard order has one `partner_id` and no field for a person at the vendor ([purchase_order.py](https://raw.githubusercontent.com/odoo/odoo/19.0/addons/purchase/models/purchase_order.py)). Community add-ons fill that gap. One adds a purchase contact to vendor price lines so replenishment orders go to that person ([product_supplierinfo_purchase_contact](https://pypi.org/project/odoo-addon-product-supplierinfo-purchase-contact/)). A forum post describes a custom Vendor Contact field that prints on the order and receives the email ([Odoo forum](https://www.odoo.com/forum/help-1/default-value-in-context-is-being-applied-to-more-than-one-model-162894), snippet).
- The Vendor field finds a vendor by name, tax ID, email or internal reference ([purchase_order.py](https://raw.githubusercontent.com/odoo/odoo/19.0/addons/purchase/models/purchase_order.py)). It does not search the names or phone numbers of the vendor's people.
- The Vendor field on the order form has no option that switches off creating a record ([purchase_views.xml](https://raw.githubusercontent.com/odoo/odoo/19.0/addons/purchase/views/purchase_views.xml)). Forum posts describe typed-name Create and Create and edit entries in such fields, and they disagree about which option removes which ([forum 1](https://www.odoo.com/forum/help-1/how-to-remove-create-and-edit-from-many2one-field-92242), [forum 2](https://www.odoo.com/forum/help-1/how-to-hide-the-create-option-on-a-field-but-not-the-create-and-edit-option-114981), snippets). I found no official page on this.
- Odoo's documentation says the request for quotation is ready to send to the vendor's email address from Contacts ([RFQ 19.0](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/purchase/manage_deals/rfq.html)). The two order email templates leave `partner_to` empty ([mail_template_data.xml](https://raw.githubusercontent.com/odoo/odoo/19.0/addons/purchase/data/mail_template_data.xml)), and I did not trace how the email composer then fills in the recipient.
- The order keeps a Vendor Reference, the vendor's own order number, to match the goods when they arrive ([RFQ 19.0](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/purchase/manage_deals/rfq.html)).

### QuickBooks

- QuickBooks Online keeps one person per vendor. A third-party import guide lists the fields as title, first, middle and last name, suffix, company, display name, phone, mobile, fax, other number, email, Business ID No., Track payments for 1099, terms and account number ([Rightworks](https://tprosupport.rightworks.com/kb/article/817-vendor-import-fields-for-rightworks-transaction-pro-online/)). Intuit's developer reference did not render for me, so I could not read the list from Intuit itself.
- Several people per vendor is not supported in Online. A moderator's answer in January 2023 was to use custom fields, and users replied that this fails when each contact needs their own email ([Intuit community](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/how-can-i-add-multiple-contacts-to-vendor-profile/00/1204687)). QuickBooks Desktop does offer Primary, Additional and Secondary contact types ([Intuit community](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/vendor-contacts/00/669836)).
- A vendor can hold CC and BCC addresses to choose from when making a purchase order, and several notes ([Add a vendor](https://quickbooks.intuit.com/learn-support/en-us/help-article/vendor-management/add-vendor-quickbooks-online/L29cgm4Ag_US_en_US)).
- QuickBooks Online has no vendor type or category field, according to community answers from 2018 and 2023 ([Intuit community](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/is-there-a-way-to-categorize-vendors/00/213037)). Custom fields on vendors in the Advanced plan are the nearest substitute ([Intuit help](https://quickbooks.intuit.com/learn-support/en-us/help-article/customize-forms/use-custom-fields-vendors-expenses-quickbooks/L7PSoFvYL_US_en_US), snippet).
- The 1099 setting is a checkbox on the vendor ([Add a vendor](https://quickbooks.intuit.com/learn-support/en-us/help-article/vendor-management/add-vendor-quickbooks-online/L29cgm4Ag_US_en_US)).
- A payee can be added while entering an expense: Intuit's walkthrough says that if you do not see the name, you can add them ([Enter and manage expenses](https://quickbooks.intuit.com/learn-support/en-us/help-article/cash-drawer/enter-manage-expenses-quickbooks-online/L1XojuBAW_US_en_US)). A community reply warns that adding vendors this way leaves a long list of names ([Intuit community](https://quickbooks.intuit.com/learn-support/en-us/other-questions/when-to-list-payee-as-a-vendor/00/361459), snippet). Another says Online will not accept the same name on two vendor profiles ([Intuit community](https://quickbooks.intuit.com/community/Reports-and-accounting/Can-I-list-two-separate-addresses-for-one-vendor-one-for-mailing/td-p/213279), snippet).

### RFMS

RFMS's help centre refused automated reading (HTTP 403), and I did not try to get around that. Everything below except the last bullet comes from search extracts.

- A purchase order has an Ordered field for the person who placed the order, and a Taken By field for "the name of the person with whom the order was placed". An order counts as still to be ordered until Taken By is filled ([Field Explanations](https://rfmsinc.zendesk.com/hc/en-us/articles/208706827-Field-Explanations-Purchase-Orders), snippet). This is the closest public match to the spec's sales rep. As far as the extract shows, it is a typed name, not a link to a contact record.
- A system option, Supplier From Supplier File Only, stops free typing of a supplier on products, inventory and purchase orders, so that the supplier's terms stay attached ([system option](https://rfmsinc.zendesk.com/hc/en-us/articles/201547097-Supplier-From-Supplier-File-Only-Products-Inventory-and-Purchase-Orders-System-Option), snippet). A cross reference handles a supplier that arrives under different names in catalog downloads ([Supplier Cross Reference](https://rfmsinc.zendesk.com/hc/en-us/articles/38860103686935-Supplier-Cross-Reference), snippet).
- Supplier Information has a separate Remittance email field ([Remittance Advice Email](https://rfmsinc.zendesk.com/hc/en-us/articles/115013057168-Remittance-Advice-Email), snippet).
- A request for an electronic supplier connection gives the store name, the supplier name and your account number at that supplier ([Connecting to Suppliers](https://rfmsinc.zendesk.com/hc/en-us/articles/38831345755799-Connecting-to-Suppliers), snippet).
- The product page confirms electronic purchase orders and supplier links in general terms and says nothing about the people at a supplier ([RFMS capabilities](https://www.cyncly.com/products/rfms-core/capabilities)).
- Not verified: whether RFMS keeps a list of people per supplier, where an order email address is stored, and whether a supplier can be added from the order screen.

### QFloors

- The public site says purchase orders are kept connected to jobs, that it connects electronically with participating suppliers, and that electronic orders and vendor bills flow through that link ([QFloors product page](https://www.qfloors.com/qfloors/), [QFloors FAQ](https://www.qfloors.com/faq/)).
- Its support articles now redirect to a general page. Search extracts say that B2B setup asks you to email the vendor your company name and account number, and that vendor setup data can be imported from a CSV file ([B2B request](https://support.qfloors.com/index.php/bishop/184-b2b/916-b2b-request), [Getting Started checklist](https://support.qfloors.com/images/knowledge-base/pdf/GettingStartedChecklist.pdf), snippets).
- Not verified: anything about a vendor's people, how a contact is picked on an order, or whether a vendor can be created during an order. QFloors publishes nothing on these that I could find, and this ADR assumes nothing about them.

### Rules that touch the supplier record

- Form 1099-NEC applies to nonemployee compensation of $2,000 or more for tax years beginning after 2025. Payments by credit or payment card are not reported on it, payments to corporations are generally excepted, and legal services are not excepted ([IRS instructions, 12/2026](https://www.irs.gov/instructions/i1099mec)). The threshold is indexed for inflation after 2026 ([IRB 2026-19](https://www.irs.gov/irb/2026-19_IRB), snippet).
- A WhatsApp click-to-chat link is `https://wa.me/` plus the full international number with no zeros, brackets or dashes ([WhatsApp help](https://faq.whatsapp.com/5913398998672934)).

## Decision

**Supplier.** `contactName` goes. `email` and `phone` stay as the company's main line. New fields are `type` (goods, services, utility, government), `status` (active, inactive), `accountNumber` (your account with them), `track1099` (boolean), `w9OnFile` (boolean) and `notes`. The demo never stores a tax ID.

**SupplierContact** is a new collection, so an order can point at one contact: `id`, `supplierId`, `name`, `role` (sales_rep, account_manager, accounts_receivable, other), `mobile`, `officePhone`, `email`, `whatsapp` (boolean), `preferredMethod` (call, email, whatsapp), `notes`, `isPrimary` and `status` (active, inactive). A contact belongs to one supplier. A rep who moves to another supplier is deactivated at the old one and added at the new one.

**Rules, in `packages/shared` and enforced by the store.**
- A contact needs a name plus an email or a phone number, in the directory and inline alike.
- A supplier with active contacts has exactly one active primary. The first contact becomes primary, and marking another clears the old one. Deactivating the primary promotes the oldest active sales rep, then the oldest active contact.
- Suppliers and contacts are deactivated, never deleted. A supplier with an open order or a balance cannot be deactivated. Inactive records leave the pickers and stay in history.
- The WhatsApp flag needs a mobile number, and the link is built from the digits with the country code added.
- One tap: call uses the mobile, then the office phone; email opens the mail client; copy is always available for desktops with no phone handler.

**Profile incomplete is derived, never stored** (ADR 0013's rule). `supplierProfileGaps(supplier, contacts)` returns what is missing: an address, or any way to reach them (a company email or phone, or an active contact with one). The label shows when the list is not empty, and the supplier's page says what to fill in.

**Supplier picker on the order.** It searches active suppliers by name, account number, company phone and email, and by the names, phones and emails of active contacts. Phones match on digits only. Results show the type and the contact that matched.

**Add new supplier inline.** Name is required, and the record is saved to the directory at once, as the spec asks. It starts with terms pay on order and credit limit 0, since no credit has been agreed, and with type goods when added from an order or services when added from an expense. Before saving, names are compared after removing case, punctuation and suffixes such as Inc, LLC, Co, Corp and Ltd. A match shows "Did you mean" with Use this one and Add anyway, so it warns and never blocks. Inline adding needs `purchasing.supplier.create`, and those without it do not see the action. The audit entry notes that it came from the order form.

**Sales rep picker.** Active contacts of the chosen supplier, primary first, then sales reps, account managers and others by name, with accounts receivable last. The primary is preselected. Changing the supplier clears the choice.

**Add new contact inline.** Name plus email or phone; the role defaults to sales rep; it is saved at once.

**PurchaseOrder.** New fields are `contactId` (nullable), `contactSnapshot` (name, email, phone, set when the order is marked ordered), `supplierRef` (the supplier's order number), `buyerId` (our user, defaulting to whoever makes the order) and `placedVia` (email, phone). A draft reads the contact live. An ordered PO keeps its snapshot, in the way an invoice keeps the tax rule it used.

**Sending the order.** The PDF and the "PO sent" email go to the chosen contact's email, or to the supplier's company email if the contact has none. With no address at all, Send becomes Mark as ordered by phone: the order is marked ordered, the PDF stays downloadable, `placedVia` records phone, and no outbox entry is made.

**Payments.** A remittance message, when one is sent, goes to the active accounts receivable contact, then the primary, then the company email. The accounts receivable role exists for this.

**Migration (next schema version) and fixtures.** Each supplier becomes type goods, active, not tracked for 1099. Its old `contactName`, `email` and `phone` become one primary sales rep, with the phone as `officePhone`. Existing orders get that `contactId`, and ordered ones get a snapshot. Fixtures keep every random draw in place and add invented service, utility and government vendors for Batch F. The supplier import keeps its columns: contact name, email and phone now write the primary contact, with optional new columns for type, account number and 1099.

## Where the research changes the spec

1. **Our buyer is missing.** "Sales rep" is the supplier's person. Odoo's purchase representative is our own employee, and RFMS records both sides. Recommendation: keep the spec's Sales rep and add `buyerId`, shown on the PDF.
2. **No 1099 data.** Both QuickBooks and Odoo keep this on the vendor, and the spec does not. Recommendation: add `track1099` and `w9OnFile`, no tax ID in the demo.
3. **No account number.** RFMS and QFloors both ask for it to connect to a supplier (snippets), and QuickBooks keeps it on the vendor. It is also what a rep asks for first on a call. Recommendation: add `accountNumber` and make it searchable.
4. **A phone-only rep cannot receive an email.** The spec allows a contact with only a phone, and also sends the order to that person by email. Recommendation: the fallback and Mark as ordered by phone described above.
5. **A rep can change after ordering.** The spec does not say what an ordered PO shows if the rep leaves or moves. Recommendation: snapshot the contact when the order is marked ordered.
6. **Inline adding invites duplicates.** RFMS has an option to forbid free typing and a tool to reconcile supplier names, and QuickBooks refuses repeated names (both snippets). Recommendation: the soft "Did you mean" check, which keeps the client's "as flexible and easy as possible".
7. **The supplier's order number is missing.** Odoo and RFMS both have a place for it. Recommendation: add the optional `supplierRef`.
8. **Expense vendors limited by type (spec F1).** A goods supplier can also bill for something that is not stock, and neither QuickBooks nor Odoo limits payees by type in the pages I read. Recommendation: list all active suppliers on the expense form, Services, Utility and Government first, with the same Add new supplier inline. The spec names inline adding only for orders, and QuickBooks offers it on expenses.

## Consequences

- The real build needs a `supplier_contacts` table, which the blueprint does not have, and a partial unique index for one active primary per supplier. Both are plain PostgreSQL, as the blueprint requires.
- `purchase_orders` gets `contact_id`, `buyer_id`, `supplier_ref` and snapshot columns, so history survives a contact's deactivation.
- The duplicate check moves to the server on a stored normalised name, so two people cannot add the same supplier at once unnoticed.
- A real 1099 report sums confirmed payments per tracked supplier for the calendar year, leaves out card payments, and reads its threshold from a setting, because the amount is indexed after 2026.
- If the real build stores tax IDs or supplier bank details, they need encryption, restricted viewing and an audited change process. The demo stores neither.
- Real email delivery replaces the outbox (assumption F-2). Electronic orders to suppliers would be a later project, and they depend on the account number.

## Sources

Opened and read:
- [Odoo Contacts 19.0](https://www.odoo.com/documentation/19.0/applications/essentials/contacts.html)
- [Odoo RFQ 19.0](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/purchase/manage_deals/rfq.html)
- [Odoo purchase_order.py, 19.0](https://raw.githubusercontent.com/odoo/odoo/19.0/addons/purchase/models/purchase_order.py)
- [Odoo purchase_views.xml, 19.0](https://raw.githubusercontent.com/odoo/odoo/19.0/addons/purchase/views/purchase_views.xml)
- [Odoo mail_template_data.xml, 19.0](https://raw.githubusercontent.com/odoo/odoo/19.0/addons/purchase/data/mail_template_data.xml)
- [OCA product_supplierinfo_purchase_contact](https://pypi.org/project/odoo-addon-product-supplierinfo-purchase-contact/)
- [Intuit: Add a vendor](https://quickbooks.intuit.com/learn-support/en-us/help-article/vendor-management/add-vendor-quickbooks-online/L29cgm4Ag_US_en_US)
- [Intuit: Enter and manage expenses](https://quickbooks.intuit.com/learn-support/en-us/help-article/cash-drawer/enter-manage-expenses-quickbooks-online/L1XojuBAW_US_en_US)
- [Intuit community: multiple contacts on a vendor](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/how-can-i-add-multiple-contacts-to-vendor-profile/00/1204687)
- [Intuit community: Vendor Contacts (Desktop)](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/vendor-contacts/00/669836)
- [Intuit community: categorize vendors](https://quickbooks.intuit.com/learn-support/en-us/reports-and-accounting/is-there-a-way-to-categorize-vendors/00/213037)
- [Rightworks: QuickBooks Online vendor import fields](https://tprosupport.rightworks.com/kb/article/817-vendor-import-fields-for-rightworks-transaction-pro-online/)
- [RFMS capabilities](https://www.cyncly.com/products/rfms-core/capabilities)
- [QFloors product page](https://www.qfloors.com/qfloors/)
- [QFloors FAQ](https://www.qfloors.com/faq/)
- [IRS instructions for Forms 1099-MISC and 1099-NEC, 12/2026](https://www.irs.gov/instructions/i1099mec)
- [WhatsApp click to chat](https://faq.whatsapp.com/5913398998672934)
- Blueprint page 14 (`docs/blueprint/blueprint.pdf`)

Seen only as a search snippet, not opened:
- [RFMS Field Explanations: Purchase Orders](https://rfmsinc.zendesk.com/hc/en-us/articles/208706827-Field-Explanations-Purchase-Orders) (403 when opened)
- [RFMS Supplier From Supplier File Only](https://rfmsinc.zendesk.com/hc/en-us/articles/201547097-Supplier-From-Supplier-File-Only-Products-Inventory-and-Purchase-Orders-System-Option) (403 when opened)
- [RFMS Supplier Cross Reference](https://rfmsinc.zendesk.com/hc/en-us/articles/38860103686935-Supplier-Cross-Reference)
- [RFMS Remittance Advice Email](https://rfmsinc.zendesk.com/hc/en-us/articles/115013057168-Remittance-Advice-Email) (403 when opened)
- [RFMS Connecting to Suppliers](https://rfmsinc.zendesk.com/hc/en-us/articles/38831345755799-Connecting-to-Suppliers) (403 when opened)
- [QFloors B2B request](https://support.qfloors.com/index.php/bishop/184-b2b/916-b2b-request) (now redirects)
- [QFloors Getting Started checklist](https://support.qfloors.com/images/knowledge-base/pdf/GettingStartedChecklist.pdf) (now redirects)
- [Odoo module partner_contact_in_several_companies](https://apps.odoo.com/apps/modules/11.0/partner_contact_in_several_companies)
- [Odoo forum: Vendor Contact field](https://www.odoo.com/forum/help-1/default-value-in-context-is-being-applied-to-more-than-one-model-162894)
- [Odoo forum: remove Create and Edit](https://www.odoo.com/forum/help-1/how-to-remove-create-and-edit-from-many2one-field-92242)
- [Odoo forum: hide Create](https://www.odoo.com/forum/help-1/how-to-hide-the-create-option-on-a-field-but-not-the-create-and-edit-option-114981)
- [Intuit: custom fields for vendors](https://quickbooks.intuit.com/learn-support/en-us/help-article/customize-forms/use-custom-fields-vendors-expenses-quickbooks/L7PSoFvYL_US_en_US)
- [Intuit community: when to list payee as a vendor](https://quickbooks.intuit.com/learn-support/en-us/other-questions/when-to-list-payee-as-a-vendor/00/361459)
- [Intuit community: two addresses for one vendor](https://quickbooks.intuit.com/community/Reports-and-accounting/Can-I-list-two-separate-addresses-for-one-vendor-one-for-mailing/td-p/213279)
- [IRS Internal Revenue Bulletin 2026-19](https://www.irs.gov/irb/2026-19_IRB)
