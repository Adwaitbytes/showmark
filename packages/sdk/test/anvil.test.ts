import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runEndToEnd } from "../examples/anvil-end-to-end";

// The strongest check that the SDK's typed data matches the contract: the real ShowmarkRegistry, deployed to a
// local anvil, accepts SDK signatures for CheckIn, DoorPass, DoorAttest and LinkWallet.
const hasFoundry = spawnSync("anvil", ["--version"]).status === 0 && spawnSync("forge", ["--version"]).status === 0;

// The SDK speaks the ticket-key protocol (audit C-01, M-01). Until the contracts workstream exports a registry ABI
// whose CheckInData carries ticketSig, the deployed contract cannot accept these signatures, so the run waits.
const exportedAbi = fileURLToPath(new URL("../../contracts/abi/ShowmarkRegistry.json", import.meta.url));
const contractsOnTickets = existsSync(exportedAbi) && readFileSync(exportedAbi, "utf8").includes('"ticketSig"');

describe.skipIf(!hasFoundry || !contractsOnTickets)("against ShowmarkRegistry on anvil", () => {
  it("records both proof modes and a wallet link signed by the SDK", { timeout: 120_000 }, async () => {
    const result = await runEndToEnd();
    expect(result.modeOne).toEqual({ attended: true, mode: 1 });
    expect(result.modeTwo).toEqual({ attended: true, mode: 2 });
    expect(result.checkedIn).toBe(2);
    expect(result.streak).toEqual({ current: 1, best: 1 });
    expect(result.walletAttended).toBe(true);
    expect(result.walletPresenceKey).toBe(result.attendeeA);
    expect(result.walletAttendedCount).toBe(1);
    expect(result.linkedPass).toBe(result.attendeeA);
  });
});
