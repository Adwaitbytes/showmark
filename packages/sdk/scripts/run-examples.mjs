// Runs every example against the built package (pnpm build first). The anvil example is skipped without Foundry.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL("../examples/", import.meta.url));
const hasAnvil = spawnSync("anvil", ["--version"]).status === 0;
let failed = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts")).sort()) {
  if (file.startsWith("anvil") && !hasAnvil) {
    console.log(`skip ${file} (anvil not installed)`);
    continue;
  }
  console.log(`\n$ node examples/${file}`);
  const result = spawnSync(process.execPath, [`${dir}${file}`], { stdio: "inherit" });
  if (result.status !== 0) failed++;
}
process.exit(failed === 0 ? 0 : 1);
