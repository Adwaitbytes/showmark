import type { Hex } from "@/lib/api/types";
import {
  MAX_BATCH,
  submitAttestation,
  submitAttestationBatch,
  type ErrorCopy,
  type RelayOutcome,
} from "./relay";
import type { SignedAttestation } from "./sign";

// The offline queue for "door scans you". A signed attestation is valid until endsAt + 3 days, so when the venue has
// no signal the door device keeps every scan here and sends them later in batches of up to 50.
//
// The store is an interface so tests run against memory and the browser runs against IndexedDB (./idb.ts).
// Records are keyed by event and attendee: the chain records one presence per attendee per event, so a second scan of
// the same code is a duplicate, never a second check-in.

export type QueueState = "pending" | "sent" | "rejected";

export interface QueuedAttestation {
  id: string;
  eventId: string;
  item: SignedAttestation;
  state: QueueState;
  queuedAt: number;
  attempts: number;
  /** Set when the relayer accepted the item (single or batch). Null for "already checked in". */
  txHash: Hex | null;
  /** Why the last attempt failed, in words staff can act on. */
  error: ErrorCopy | null;
}

export interface QueueStore {
  get(id: string): Promise<QueuedAttestation | undefined>;
  put(record: QueuedAttestation): Promise<void>;
  listByEvent(eventId: string): Promise<QueuedAttestation[]>;
  delete(id: string): Promise<void>;
}

export class MemoryQueueStore implements QueueStore {
  private readonly records = new Map<string, QueuedAttestation>();

  async get(id: string) {
    const r = this.records.get(id);
    return r ? structuredClone(r) : undefined;
  }

  async put(record: QueuedAttestation) {
    this.records.set(record.id, structuredClone(record));
  }

  async listByEvent(eventId: string) {
    return [...this.records.values()].filter((r) => r.eventId === eventId).map((r) => structuredClone(r));
  }

  async delete(id: string) {
    this.records.delete(id);
  }
}

export function attestationId(item: Pick<SignedAttestation, "eventId" | "attendee">): string {
  return `${item.eventId}:${item.attendee.toLowerCase()}`;
}

export interface QueueSummary {
  pending: number;
  sent: number;
  rejected: number;
}

export interface FlushResult {
  sent: number;
  rejected: number;
  /** Still waiting after this flush. */
  remaining: number;
  /** Set when flushing stopped early because the relayer was unreachable. */
  stoppedBy: ErrorCopy | null;
}

export interface Submitters {
  batch(items: readonly SignedAttestation[]): Promise<RelayOutcome<{ txHash: Hex; accepted: number }>>;
  single(item: SignedAttestation): Promise<RelayOutcome<{ txHash: Hex }>>;
}

const defaultSubmitters: Submitters = {
  batch: (items) => submitAttestationBatch(items),
  single: (item) => submitAttestation(item),
};

/** The relayer's answer when this attendee is already recorded. That is a success for the door. */
export const ALREADY_PRESENT_CODE = "already_present";

export class DoorQueue {
  private readonly inflight = new Map<string, Promise<FlushResult>>();

  constructor(
    private readonly store: QueueStore,
    private readonly submitters: Submitters = defaultSubmitters,
    private readonly now: () => number = Date.now,
  ) {}

  /** Saves a signed attestation. A repeat scan of a code already waiting or sent is reported, not stored twice. */
  async enqueue(item: SignedAttestation): Promise<"added" | "duplicate"> {
    const id = attestationId(item);
    const existing = await this.store.get(id);
    if (existing && existing.state !== "rejected") return "duplicate";
    await this.store.put({ id, eventId: item.eventId, item, state: "pending", queuedAt: this.now(), attempts: 0, txHash: null, error: null });
    return "added";
  }

  /** Records the result of a single check-in that was sent straight away, so the list shows it. */
  async recordSent(item: SignedAttestation, txHash: Hex | null): Promise<void> {
    const id = attestationId(item);
    await this.store.put({ id, eventId: item.eventId, item, state: "sent", queuedAt: this.now(), attempts: 1, txHash, error: null });
  }

  async list(eventId: string): Promise<QueuedAttestation[]> {
    const records = await this.store.listByEvent(eventId);
    return records.sort((a, b) => b.queuedAt - a.queuedAt);
  }

  async summary(eventId: string): Promise<QueueSummary> {
    const records = await this.store.listByEvent(eventId);
    const summary: QueueSummary = { pending: 0, sent: 0, rejected: 0 };
    for (const r of records) summary[r.state] += 1;
    return summary;
  }

  /** Sends every pending attestation for an event. Concurrent calls share one run. */
  flush(eventId: string): Promise<FlushResult> {
    const running = this.inflight.get(eventId);
    if (running) return running;
    const run = this.flushOnce(eventId).finally(() => this.inflight.delete(eventId));
    this.inflight.set(eventId, run);
    return run;
  }

  private async flushOnce(eventId: string): Promise<FlushResult> {
    const pending = (await this.store.listByEvent(eventId)).filter((r) => r.state === "pending").sort((a, b) => a.queuedAt - b.queuedAt);
    const result: FlushResult = { sent: 0, rejected: 0, remaining: pending.length, stoppedBy: null };

    for (let start = 0; start < pending.length; start += MAX_BATCH) {
      const chunk = pending.slice(start, start + MAX_BATCH);
      const outcome = await this.submitters.batch(chunk.map((r) => r.item));
      if (outcome.kind === "ok") {
        for (const r of chunk) await this.store.put({ ...r, state: "sent", attempts: r.attempts + 1, txHash: outcome.value.txHash, error: null });
        result.sent += chunk.length;
        result.remaining -= chunk.length;
        continue;
      }
      if (outcome.kind === "retry") {
        for (const r of chunk) await this.store.put({ ...r, attempts: r.attempts + 1, error: outcome.error });
        result.stoppedBy = outcome.error;
        return result;
      }
      // The relayer refused the whole batch. Send the items one by one so a single bad item cannot hold back the rest.
      const single = await this.sendOneByOne(chunk);
      result.sent += single.sent;
      result.rejected += single.rejected;
      result.remaining -= single.sent + single.rejected;
      if (single.stoppedBy) {
        result.stoppedBy = single.stoppedBy;
        return result;
      }
    }
    return result;
  }

  private async sendOneByOne(chunk: QueuedAttestation[]): Promise<Omit<FlushResult, "remaining">> {
    const out = { sent: 0, rejected: 0, stoppedBy: null as ErrorCopy | null };
    for (const r of chunk) {
      const outcome = await this.submitters.single(r.item);
      const attempts = r.attempts + 1;
      if (outcome.kind === "ok") {
        await this.store.put({ ...r, state: "sent", attempts, txHash: outcome.value.txHash, error: null });
        out.sent += 1;
      } else if (outcome.kind === "rejected" && outcome.error.code === ALREADY_PRESENT_CODE) {
        await this.store.put({ ...r, state: "sent", attempts, txHash: null, error: null });
        out.sent += 1;
      } else if (outcome.kind === "rejected") {
        await this.store.put({ ...r, state: "rejected", attempts, error: outcome.error });
        out.rejected += 1;
      } else {
        await this.store.put({ ...r, attempts, error: outcome.error });
        out.stoppedBy = outcome.error;
        return out;
      }
    }
    return out;
  }
}
