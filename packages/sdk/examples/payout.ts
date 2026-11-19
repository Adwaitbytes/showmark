// What one verified presence pays, split the way the vault splits it.  Run: node examples/payout.ts
import { splitPayout } from "@showmark/sdk";

// 2 QUSDC per presence (6 decimals), 2% protocol fee, attendee gets 50% of the rest.
const split = splitPayout(2_000_000n, 200, 5_000);
console.log(Object.fromEntries(Object.entries(split).map(([k, v]) => [k, Number(v) / 1e6])));
