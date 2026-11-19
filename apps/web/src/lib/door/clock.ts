// The chain judges door codes by block time, not by the door device's clock. A door laptop whose clock is a minute
// slow would show codes the chain already considers stale, and one that runs fast would show codes from the future.
// ChainClock estimates the offset between the device clock and chain time from the latest block's timestamp, and the
// door screen uses chain time for every issuedAt and attestedAt it signs.
//
// A block's timestamp is when it was produced, so the latest block is always somewhere between 0 seconds and one
// block interval old when it reaches us. Each sample therefore underestimates chain time by that age. Keeping the
// largest offset of the last few samples picks the freshest block seen and cancels most of that bias. What remains
// makes codes look a few seconds older than they are, which only shortens the pass window slightly and is safe.

export const SKEW_WARNING_MS = 20_000;
const MAX_SAMPLES = 5;

export interface ClockSample {
  /** Latest block timestamp, in seconds. */
  blockTimestamp: bigint;
  /** Device time (ms) when the block arrived. */
  receivedAtMs: number;
}

export class ChainClock {
  private samples: number[] = [];

  constructor(private readonly deviceNow: () => number = Date.now) {}

  /** Records one observation of the latest block. */
  record(sample: ClockSample): void {
    const offset = Number(sample.blockTimestamp) * 1000 - sample.receivedAtMs;
    if (!Number.isFinite(offset)) return;
    this.samples = [...this.samples, offset].slice(-MAX_SAMPLES);
  }

  /** Chain time minus device time, in ms. Null until the first block has been read. */
  get offsetMs(): number | null {
    return this.samples.length === 0 ? null : Math.max(...this.samples);
  }

  get synced(): boolean {
    return this.samples.length > 0;
  }

  /** Best estimate of chain time now, in ms. Falls back to the device clock before the first sample. */
  nowMs(): number {
    return this.deviceNow() + (this.offsetMs ?? 0);
  }

  /** Chain time now in whole seconds, the unit the registry uses. */
  nowSeconds(): bigint {
    return BigInt(Math.floor(this.nowMs() / 1000));
  }

  /** True when the device clock is far enough off that the organizer should fix it. */
  isSkewed(thresholdMs: number = SKEW_WARNING_MS): boolean {
    const offset = this.offsetMs;
    return offset !== null && Math.abs(offset) > thresholdMs;
  }
}

/** "2 minutes", "45 seconds": how far off the device clock is, for the warning banner. */
export function describeSkew(offsetMs: number): string {
  const seconds = Math.round(Math.abs(offsetMs) / 1000);
  if (seconds < 120) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} minutes`;
  return `${Math.round(minutes / 60)} hours`;
}
