import { StyleSheet, Text, View } from "@react-pdf/renderer";
import { brandTokens, DOCUMENT_TOKENS } from "@workspace/shared";

/** PDF colors come from the document tokens: Slate text, muted text, Grout lines, the brand accent. */
export const { ink: INK, muted: MUTED, hairline: LINE, onBrand: ON_BRAND, paid: PAID } = DOCUMENT_TOKENS;

/** Styles shared by the invoice and receipt PDFs, so they look like one family of documents. */
export const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, color: INK, fontFamily: "Helvetica" },
  row: { flexDirection: "row", justifyContent: "space-between" },
  muted: { color: MUTED },
  title: { fontSize: 18, fontFamily: "Helvetica-Bold" },
  bold: { fontFamily: "Helvetica-Bold" },
  stamp: {
    marginTop: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1.5,
    borderRadius: 3,
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    letterSpacing: 2,
  },
  section: { marginTop: 22 },
  label: { color: MUTED, fontSize: 8, marginBottom: 3 },
  th: { color: MUTED, fontSize: 8, paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: LINE },
  td: { paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: LINE },
  desc: { flex: 1, paddingRight: 8 },
  num: { width: 80, textAlign: "right" },
  totals: { width: 220, marginLeft: "auto", marginTop: 16 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  footer: {
    position: "absolute",
    left: 40,
    right: 40,
    bottom: 30,
    color: MUTED,
    fontSize: 8,
    borderTopWidth: 0.5,
    borderTopColor: LINE,
    paddingTop: 6,
  },
});

/** The company monogram in its brand color, top left of every PDF. */
export function Monogram({ company }: { company: { brandColor: string; monogram: string } }) {
  const fill = brandTokens(company.brandColor).light.accent;
  return (
    <View
      style={{
        width: 32,
        height: 32,
        borderRadius: 4,
        backgroundColor: fill,
        justifyContent: "center",
        alignItems: "center",
        marginRight: 10,
      }}
    >
      <Text style={{ color: ON_BRAND, fontFamily: "Helvetica-Bold", fontSize: 11 }}>{company.monogram}</Text>
    </View>
  );
}
