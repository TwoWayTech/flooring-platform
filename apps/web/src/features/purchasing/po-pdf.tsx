import { Document, Page, Text, View } from "@react-pdf/renderer";
import {
  cartonEquivalent,
  formatNumber,
  locationName,
  UNIT_LABELS,
  type CompanySettings,
  type Location,
  type PurchaseOrder,
  type Supplier,
  poLineAmount,
} from "@workspace/shared";
import { LINE, Monogram, styles } from "@/features/invoices/pdf-parts";

/** A purchase order with every value formatted, as the PDF prints it (spec B2). */
export interface PoModel {
  number: string;
  company: { name: string; lines: string[]; brandColor: string; monogram: string };
  supplier: string;
  attention: string;
  expected: string;
  supplierRef: string;
  lines: { id: string; description: string; quantity: string; cost: string; amount: string; into: string }[];
  total: string;
  footer: string;
}

/** Builds the PDF model; the sales rep is the snapshot once ordered, or the chosen contact on a draft. */
export function buildPoModel(
  po: PurchaseOrder,
  supplier: Supplier | undefined,
  repName: string,
  locations: readonly Location[],
  settings: CompanySettings,
): PoModel {
  const money = (v: string) => formatNumber(v, "money", settings.numbers);
  const qty = (v: string) => formatNumber(v, "quantity", settings.numbers);
  const { profile, branding } = settings;
  return {
    number: po.number,
    company: {
      name: branding.displayName,
      lines: [
        profile.legalName,
        profile.address.street,
        `${profile.address.city}, ${profile.address.state} ${profile.address.zip}`,
        profile.phone,
      ],
      brandColor: branding.brandColor,
      monogram: branding.monogram,
    },
    supplier: supplier?.name ?? "",
    attention: repName,
    expected: po.expectedAt,
    supplierRef: po.supplierRef,
    lines: po.lines.map((l) => ({
      id: l.id,
      description: l.description,
      quantity: `${qty(l.quantity)} ${UNIT_LABELS[l.unit]}${
        l.sqFtPerCarton ? ` (${cartonEquivalent(l.quantity, l.sqFtPerCarton).cartons} cartons)` : ""
      }`,
      cost: money(l.unitCost),
      amount: money(poLineAmount(l)),
      into: locationName([...locations], l.locationId ?? po.locationId),
    })),
    total: money(po.total),
    footer: settings.localization.documents.legalFooter,
  };
}

/** The purchase order PDF sent to the supplier's sales rep, styled like the invoice (spec B2). */
export function PoPdf({ model }: { model: PoModel }) {
  return (
    <Document title={`Purchase order ${model.number}`} author={model.company.name}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.row}>
          <View style={{ flexDirection: "row" }}>
            <Monogram company={model.company} />
            <View>
              <Text style={styles.bold}>{model.company.name}</Text>
              {model.company.lines.map((l) => (
                <Text key={l} style={styles.muted}>
                  {l}
                </Text>
              ))}
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={styles.title}>Purchase order {model.number}</Text>
            <Text style={styles.muted}>Expected {model.expected}</Text>
            {model.supplierRef ? <Text style={styles.muted}>Your order {model.supplierRef}</Text> : null}
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.bold}>{model.supplier}</Text>
          {model.attention ? <Text style={styles.muted}>Attention: {model.attention}</Text> : null}
        </View>
        <View style={styles.section}>
          {model.lines.map((l) => (
            <View key={l.id} style={[styles.totalRow, { borderBottomWidth: 0.5, borderBottomColor: LINE }]}>
              <View style={{ width: 300 }}>
                <Text>{l.description}</Text>
                <Text style={styles.muted}>
                  {l.quantity} at {l.cost}, into {l.into}
                </Text>
              </View>
              <Text>{l.amount}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.bold}>Total</Text>
            <Text style={styles.bold}>{model.total}</Text>
          </View>
        </View>
        <Text style={styles.footer}>{model.footer}</Text>
      </Page>
    </Document>
  );
}
