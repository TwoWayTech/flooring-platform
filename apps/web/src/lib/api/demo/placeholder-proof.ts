/** Text safe inside a PDF string: no backslashes or parentheses, plain ASCII. */
const pdfText = (text: string) => text.replace(/[\\()]/g, "").replace(/[^\x20-\x7e]/g, "-");

/**
 * A one-page PDF standing in for a seeded payment's proof (spec section H: payments with proof
 * files as generated placeholders). Built by hand, so no PDF library loads for it.
 */
export function placeholderProof(
  lines: readonly string[],
  title = "Sample proof of payment",
  footer = "Generated for the demo. Not a real receipt.",
): Blob {
  const content = [
    "BT /F1 16 Tf 72 720 Td",
    `(${pdfText(title)}) Tj`,
    "/F1 11 Tf",
    ...lines.flatMap((line) => ["0 -22 Td", `(${pdfText(line)}) Tj`]),
    "0 -40 Td",
    `(${pdfText(footer)}) Tj`,
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([body], { type: "application/pdf" });
}
