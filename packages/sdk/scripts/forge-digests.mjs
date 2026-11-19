// Regenerates test/fixtures/eip712-digests.json by running the Solidity harness in test/foundry.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../test/foundry/", import.meta.url));
const result = spawnSync("forge", ["script", "script/Digests.s.sol"], { cwd, stdio: "inherit" });
if (result.error) {
  console.error(`Could not run forge: ${result.error.message}. Install Foundry from https://getfoundry.sh and try again.`);
  process.exit(1);
}
process.exit(result.status ?? 1);
