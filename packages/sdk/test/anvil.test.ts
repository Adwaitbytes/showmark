import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { runEndToEnd } from "../examples/anvil-end-to-end";

// The strongest check that the SDK's typed data matches the contract: the real ShowmarkRegistry, deployed to a
// local anvil, accepts SDK signatures for CheckIn, DoorPass, DoorAttest and LinkWallet.
const hasFoundry = spawnSync("anvil", ["--version"]).status === 0 && spawnSync("forge", ["--version"]).status === 0;

describe.skipIf(!hasFoundry)("against ShowmarkRegistry on anvil", () => {
  it("records both proof modes and a wallet link signed by the SDK", { timeout: 120_000 }, async () => {
    const result = await runEndToEnd();
    expect(result.modeOne).toEqual({ attended: true, mode: 1 });
    expect(result.modeTwo).toEqual({ attended: true, mode: 2 });
    expect(result.checkedIn).toBe(2);
    expect(result.streak).toEqual({ current: 1, best: 1 });
    expect(result.walletAttended).toBe(true);
    expect(result.walletPresenceKey).toBe(result.attendeeA);
    expect(result.walletAttendedCount).toBe(1);
  });
});
