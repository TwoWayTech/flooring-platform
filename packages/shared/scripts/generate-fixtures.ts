import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateFixtures } from "./fixtures/generate";

/** Writes the seeded fixtures to packages/shared/fixtures as JSON (run with `pnpm fixtures`). */
const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
mkdirSync(outDir, { recursive: true });
const { platform, companies } = generateFixtures();
writeFileSync(join(outDir, "platform.json"), JSON.stringify(platform));
for (const company of companies) {
  const file = join(outDir, `${company.companyId}.json`);
  writeFileSync(file, JSON.stringify(company));
  console.log(
    `${company.companyId}: ${company.invoices.length} invoices, ${company.employees.length} employees -> ${file}`,
  );
}
