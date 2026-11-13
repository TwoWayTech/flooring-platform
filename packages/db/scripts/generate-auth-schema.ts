import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Regenerates src/control/auth.ts with the Better Auth CLI from better-auth.config.ts, keeping the
 * header that explains the file, so a regeneration never loses it.
 */
function main(): void {
  const dir = mkdtempSync(join(tmpdir(), "auth-schema-"));
  const generated = join(dir, "auth.ts");
  const target = "src/control/auth.ts";
  try {
    execSync(`auth generate --config better-auth.config.ts --output "${generated}" --yes`, { stdio: "inherit" });
    const header = readFileSync("scripts/auth-schema-header.txt", "utf8");
    writeFileSync(target, header + readFileSync(generated, "utf8"));
    execSync(`prettier --write ${target}`, { stdio: "inherit" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
